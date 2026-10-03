'use client';

import type { FieldControl } from '@/review/fields';

/**
 * Input for one scalar resolution value. `undefined` means "no selection"
 * (unresolved) and is always offered explicitly; nothing is preselected unless
 * a value already exists. It only collects a value: the server validates it.
 */

export const UNSET = '__unset__';
const NULL = '__null__';

export interface Lists {
  categories: { key: string; name: string }[];
  methods: { key: string; name: string }[];
}

const encode = (v: unknown) => (v === undefined ? UNSET : v === null ? NULL : String(v));

export function ValueInput({
  control,
  value,
  onChange,
  lists,
  name,
  radios = false,
  unsetLabel = 'Sin resolver',
}: {
  control: FieldControl;
  value: unknown;
  onChange: (v: unknown) => void;
  lists: Lists;
  name: string;
  radios?: boolean;
  unsetLabel?: string;
}) {
  const options: { value: string; label: string; raw: unknown }[] =
    control.type === 'enum'
      ? control.options.map((o) => ({ value: encode(o.value), label: o.label, raw: o.value }))
      : control.type === 'boolean'
        ? [
            { value: 'true', label: control.trueLabel, raw: true },
            { value: 'false', label: control.falseLabel, raw: false },
          ]
        : control.type === 'category'
          ? lists.categories.map((c) => ({
              value: c.key,
              label: `${c.name} (${c.key})`,
              raw: c.key,
            }))
          : control.type === 'method'
            ? lists.methods.map((m) => ({
                value: m.key,
                label: `${m.key} · ${m.name}`,
                raw: m.key,
              }))
            : [];

  if (options.length > 0) {
    const pick = (encoded: string) =>
      onChange(encoded === UNSET ? undefined : options.find((o) => o.value === encoded)?.raw);
    if (radios) {
      return (
        <div className="choices" role="radiogroup">
          {options.map((o) => (
            <label key={o.value}>
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={encode(value) === o.value}
                onChange={() => pick(o.value)}
              />
              {o.label}
            </label>
          ))}
          <label className="unres">
            <input
              type="radio"
              name={name}
              value={UNSET}
              checked={value === undefined}
              onChange={() => pick(UNSET)}
            />
            {unsetLabel}
          </label>
        </div>
      );
    }
    return (
      <select name={name} value={encode(value)} onChange={(e) => pick(e.target.value)}>
        <option value={UNSET}>— {unsetLabel} —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (control.type === 'int') {
    return (
      <input
        type="number"
        name={name}
        min={1}
        step={1}
        value={typeof value === 'number' ? value : ''}
        placeholder="sin resolver"
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }
  if (control.type === 'datetime') {
    const local = typeof value === 'string' ? value.slice(0, 16) : '';
    return (
      <span className="row">
        <input
          type="datetime-local"
          name={name}
          value={local}
          onChange={(e) => onChange(e.target.value === '' ? undefined : `${e.target.value}:00Z`)}
        />
        <span className="small muted">UTC</span>
      </span>
    );
  }
  if (control.type === 'text') {
    return (
      <input
        type="text"
        name={name}
        value={typeof value === 'string' ? value : ''}
        placeholder="(se usa el valor del Excel)"
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        style={{ minWidth: 320 }}
      />
    );
  }
  return <span className="muted small">(control {control.type})</span>;
}
