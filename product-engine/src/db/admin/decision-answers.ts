import { OWNER_DECISIONS, decisionById } from '@/decisions/reference';
import {
  DECISION_APPLICATIONS,
  DecisionAnswerInput,
  validateAnswer,
} from '@/quality/decision-actions';
import type { Queryable } from '../client';
import { applyBulk, previewBulk, type BulkPreview } from './bulk';

/**
 * Explicit owner decisions (STEP 08 §13–15). The app never answers a decision: a person records what the
 * owner decided, with actor, time and notes (append-only; a later answer revises the earlier one and
 * both stay in history). An answer can then be applied to staging candidates only through the bulk
 * planner (preview, overwrite confirmation, stale-preview protection), as a DECISION_GROUP operation.
 */

type Row = Record<string, unknown>;

export interface AnswerView {
  id: string;
  decisionId: string;
  summary: string;
  notes: string | null;
  actor: string;
  answeredAt: string;
  assignments: { value: unknown; legacyIds: string[] }[];
  /** items settled without a machine assignment */
  covers: string[];
  revision: number;
}

const toView = (r: Row, revision: number): AnswerView => ({
  id: r.id as string,
  decisionId: r.decision_id as string,
  summary: r.summary as string,
  notes: (r.notes as string | null) ?? null,
  actor: r.actor as string,
  answeredAt: new Date(String(r.answered_at)).toISOString(),
  covers: (r.answer as { covers?: string[] }).covers ?? [],
  assignments: ((r.answer as { assignments?: AnswerView['assignments'] }).assignments ?? []).map(
    (a) => ({
      value: a.value,
      legacyIds: a.legacyIds,
    }),
  ),
  revision,
});

export async function answerHistory(db: Queryable, decisionId: string): Promise<AnswerView[]> {
  const rows = (
    await db.query(
      `select * from owner_decision_answer where decision_id = $1 order by answered_at, id`,
      [decisionId],
    )
  ).rows as Row[];
  return rows.map((r, i) => toView(r, i + 1));
}

export async function currentAnswer(db: Queryable, decisionId: string): Promise<AnswerView | null> {
  const h = await answerHistory(db, decisionId);
  return h.at(-1) ?? null;
}

export type RecordAnswerResult =
  | { ok: true; answerId: string; revision: number }
  | { ok: false; errors: { path: string; message: string }[] };

export async function recordDecisionAnswer(
  db: Queryable,
  raw: unknown,
  actor: string,
): Promise<RecordAnswerResult> {
  const parsed = DecisionAnswerInput.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  const input = parsed.data;
  const valid = validateAnswer(input);
  if (!valid.ok) return valid;
  const previous = await currentAnswer(db, input.decisionId);
  const row = (
    await db.query(
      `insert into owner_decision_answer (decision_id, answer, summary, notes, actor, supersedes_id)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        input.decisionId,
        JSON.stringify({ assignments: input.assignments ?? [], covers: input.covers ?? [] }),
        input.summary,
        input.notes ?? null,
        actor,
        previous?.id ?? null,
      ],
    )
  ).rows[0] as Row;
  return { ok: true, answerId: row.id as string, revision: (previous?.revision ?? 0) + 1 };
}

export interface DecisionState {
  id: string;
  priority: 'P1' | 'P2';
  title: string;
  status: 'OPEN' | 'ANSWERED';
  affectedLegacy: number;
  /** Staged CATALOG_ITEM candidates that match the affected legacy ids. */
  stagedCandidates: number;
  /** …of which still have something open (i.e. the answer would still change them). */
  stagedUnresolved: number;
  answer: AnswerView | null;
  /** Machine-applicable field, if this decision maps onto one. */
  application: { kind: string; field: string; label: string } | null;
  responseMode: string;
}

export async function decisionStates(db: Queryable): Promise<DecisionState[]> {
  const out: DecisionState[] = [];
  for (const d of OWNER_DECISIONS) {
    const legacy = d.affected.map((a) => a.legacyId);
    const staged = (
      await db.query(
        `select count(*)::int as n,
                count(*) filter (where cardinality(coalesce(v.open_fields, '{}')) > 0)::int as open
           from import_candidate c join v_review_candidate v on v.id = c.id
           join import_batch b on b.id = c.batch_id
          where c.kind = 'CATALOG_ITEM' and b.source_role = 'PRIMARY_RC'
            and c.review_status <> 'REJECTED' and c.proposal ->> 'legacyId' = any($1)`,
        [legacy],
      )
    ).rows[0] as Row;
    const answer = await currentAnswer(db, d.id);
    out.push({
      id: d.id,
      priority: d.priority,
      title: d.title,
      status: answer ? 'ANSWERED' : 'OPEN',
      affectedLegacy: legacy.length,
      stagedCandidates: Number(staged.n),
      stagedUnresolved: Number(staged.open),
      answer,
      application: DECISION_APPLICATIONS[d.id] ?? null,
      responseMode: d.responseMode,
    });
  }
  return out;
}

// ------------------------------------------------------------------ applying an answer

async function targetsOf(db: Queryable, legacyIds: string[]): Promise<string[]> {
  return (
    (
      await db.query(
        `select c.id from import_candidate c join import_batch b on b.id = c.batch_id
          where c.kind = 'CATALOG_ITEM' and b.source_role = 'PRIMARY_RC' and c.review_status <> 'REJECTED'
            and c.proposal ->> 'legacyId' = any($1) order by c.lineage_key`,
        [legacyIds],
      )
    ).rows as Row[]
  ).map((r) => r.id as string);
}

type AssignmentRef = { decisionId: string; index: number };

async function assignmentOf(db: Queryable, ref: AssignmentRef) {
  const app = DECISION_APPLICATIONS[ref.decisionId];
  if (!decisionById(ref.decisionId) || !app)
    return { ok: false, error: 'this decision has no applicable form' } as const;
  const answer = await currentAnswer(db, ref.decisionId);
  if (!answer) return { ok: false, error: `${ref.decisionId} has no recorded answer` } as const;
  const a = answer.assignments[ref.index];
  if (!a) return { ok: false, error: 'no such assignment in the current answer' } as const;
  return { ok: true, app, answer, assignment: a } as const;
}

export type ApplicationPreview =
  { ok: true; preview: BulkPreview; answerId: string } | { ok: false; message: string };

export async function previewDecisionAssignment(
  db: Queryable,
  ref: AssignmentRef,
): Promise<ApplicationPreview> {
  const r = await assignmentOf(db, ref);
  if (!r.ok) return { ok: false, message: r.error };
  const ids = await targetsOf(db, r.assignment.legacyIds);
  if (ids.length === 0) return { ok: false, message: 'none of the listed items is staged' };
  const p = await previewBulk(db, {
    candidateIds: ids,
    kind: r.app.kind,
    changes: { [r.app.field]: r.assignment.value },
    strict: true,
  });
  if (!p.ok) return { ok: false, message: p.errors.map((e) => e.message).join('; ') };
  return { ok: true, preview: p.preview, answerId: r.answer.id };
}

export async function applyDecisionAssignment(
  db: Queryable,
  ref: AssignmentRef & {
    planSha256: string;
    overwrite: boolean;
    actor: string;
    reason?: string | null;
  },
) {
  const r = await assignmentOf(db, ref);
  if (!r.ok)
    return {
      ok: false as const,
      errors: [{ code: 'DECISION_NOT_ANSWERED' as const, message: r.error }],
    };
  const ids = await targetsOf(db, r.assignment.legacyIds);
  return applyBulk(db, {
    candidateIds: ids,
    kind: r.app.kind,
    changes: { [r.app.field]: r.assignment.value },
    strict: true,
    actor: ref.actor,
    planSha256: ref.planSha256,
    overwrite: ref.overwrite,
    reason:
      ref.reason ?? `Respuesta registrada de ${ref.decisionId} (${r.answer.summary.slice(0, 120)})`,
    origin: 'DECISION_GROUP',
    originRef: ref.decisionId,
  });
}
