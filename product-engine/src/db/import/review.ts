import { canonicalJson, sha256Hex } from '@/import/keys';
import { ProposalSchema, type CandidateKind } from '@/import/proposal';
import { unresolvedFields } from '@/import/requirements';
import { parseResolution } from '@/import/resolution';
import type { Queryable } from '../client';

/**
 * Human review: explicit, programmatic approval or rejection of one candidate.
 * There is no bulk or automatic approval. Approval binds the resolution to the
 * exact proposal and source workbook (approval_sha256): a new import of a
 * changed workbook produces new candidates that need a new approval.
 */

export interface ReviewError {
  code:
    | 'CANDIDATE_NOT_FOUND'
    | 'NOT_APPROVABLE'
    | 'INVALID_RESOLUTION'
    | 'UNRESOLVED_FIELD'
    | 'REVIEWER_REQUIRED'
    | 'REASON_REQUIRED';
  message: string;
  field?: string;
}

export type ReviewResult =
  | { ok: true; candidateId: string; reviewStatus: string; approvalSha256?: string }
  | { ok: false; errors: ReviewError[] };

export function approvalHash(input: {
  sourceSha256: string;
  payloadSha256: string;
  kind: string;
  resolution: Record<string, unknown>;
}): string {
  return sha256Hex(canonicalJson(input));
}

async function loadForReview(db: Queryable, candidateId: string) {
  return (
    await db.query(
      `select c.id, c.kind, c.proposal, c.payload_sha256, c.review_status, b.source_sha256
         from import_candidate c join import_batch b on b.id = c.batch_id
        where c.id = $1 for update of c`,
      [candidateId],
    )
  ).rows[0] as
    | {
        id: string;
        kind: CandidateKind;
        proposal: unknown;
        payload_sha256: string;
        review_status: string;
        source_sha256: string;
      }
    | undefined;
}

export async function approveCandidate(
  db: Queryable,
  candidateId: string,
  input: { reviewer: string; resolution?: unknown },
): Promise<ReviewResult> {
  if (!input.reviewer?.trim())
    return { ok: false, errors: [{ code: 'REVIEWER_REQUIRED', message: 'reviewer is required' }] };
  const c = await loadForReview(db, candidateId);
  if (!c)
    return {
      ok: false,
      errors: [{ code: 'CANDIDATE_NOT_FOUND', message: `candidate ${candidateId} not found` }],
    };
  if (c.review_status !== 'VALID' && c.review_status !== 'WARNING') {
    return {
      ok: false,
      errors: [
        {
          code: 'NOT_APPROVABLE',
          message: `candidate is ${c.review_status}; only VALID or WARNING can be approved`,
        },
      ],
    };
  }
  const parsed = parseResolution(c.kind, input.resolution);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map((e) => ({
        code: 'INVALID_RESOLUTION' as const,
        message: e.message,
        field: e.path,
      })),
    };
  }
  const proposal = ProposalSchema.parse(c.proposal);
  const missing = unresolvedFields(proposal, parsed.resolution);
  if (missing.length > 0) {
    return {
      ok: false,
      errors: missing.map((field) => ({
        code: 'UNRESOLVED_FIELD' as const,
        field,
        message: `${field} is unknown in the source; the approval must resolve it`,
      })),
    };
  }
  const hash = approvalHash({
    sourceSha256: c.source_sha256,
    payloadSha256: c.payload_sha256,
    kind: c.kind,
    resolution: parsed.resolution,
  });
  await db.query(
    `update import_candidate
        set review_status = 'APPROVED', resolution = $2, approved_by = $3, approved_at = clock_timestamp(), approval_sha256 = $4
      where id = $1`,
    [candidateId, JSON.stringify(parsed.resolution), input.reviewer.trim(), hash],
  );
  return { ok: true, candidateId, reviewStatus: 'APPROVED', approvalSha256: hash };
}

export async function rejectCandidate(
  db: Queryable,
  candidateId: string,
  input: { reviewer: string; reason: string },
): Promise<ReviewResult> {
  if (!input.reviewer?.trim())
    return { ok: false, errors: [{ code: 'REVIEWER_REQUIRED', message: 'reviewer is required' }] };
  if (!input.reason?.trim())
    return { ok: false, errors: [{ code: 'REASON_REQUIRED', message: 'reason is required' }] };
  const c = await loadForReview(db, candidateId);
  if (!c)
    return {
      ok: false,
      errors: [{ code: 'CANDIDATE_NOT_FOUND', message: `candidate ${candidateId} not found` }],
    };
  if (
    c.review_status === 'PUBLISHED' ||
    c.review_status === 'REJECTED' ||
    c.review_status === 'PENDING'
  ) {
    return {
      ok: false,
      errors: [{ code: 'NOT_APPROVABLE', message: `candidate is ${c.review_status}` }],
    };
  }
  await db.query(
    `update import_candidate
        set review_status = 'REJECTED', rejected_by = $2, rejected_at = clock_timestamp(), rejection_reason = $3
      where id = $1`,
    [candidateId, input.reviewer.trim(), input.reason.trim()],
  );
  return { ok: true, candidateId, reviewStatus: 'REJECTED' };
}
