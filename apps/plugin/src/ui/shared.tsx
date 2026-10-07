import type { Catalog, DraftRow } from '@string-binder/contracts';
import { newIdentity, ROLE_LIST } from '@string-binder/domain';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
export const EMPTY_CATALOG: Catalog = { seq: 0, records: [], products: [], mappings: [] };
export const identity = () => newIdentity(Date.now(), crypto.getRandomValues(new Uint8Array(10)));
export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return <span className={`badge badge--${tone}`}>{label}</span>;
}
export function ContextEditor({
  row,
  catalog,
  disabled,
  change,
}: {
  row: DraftRow;
  catalog: Catalog;
  disabled: boolean;
  change: (update: Partial<DraftRow>) => void;
}) {
  return (
    <div className="context-fields">
      <label>
        Product
        <select
          value={row.product}
          disabled={disabled || row.action === 'edit'}
          onChange={(e) => change({ product: e.target.value })}
        >
          <option value="">Choose…</option>
          {catalog.products
            .filter((p) => p.id !== 'shared' || row.baseline?.product === 'shared')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
        </select>
      </label>
      {(['feature', 'screen', 'context', 'note'] as const).map((field) => (
        <label key={field}>
          {field}
          <input
            value={row.context[field]}
            disabled={disabled}
            onChange={(e) => change({ context: { ...row.context, [field]: e.target.value } })}
          />
        </label>
      ))}
      <label>
        Role
        <select
          value={row.context.role}
          disabled={disabled}
          onChange={(e) => change({ context: { ...row.context, role: e.target.value } })}
        >
          {!(ROLE_LIST as readonly string[]).includes(row.context.role) && (
            <option value={row.context.role}>{row.context.role}</option>
          )}
          {ROLE_LIST.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label>
        Qualifier
        <select
          value={row.context.qualifier ?? ''}
          disabled={disabled}
          onChange={(e) =>
            change({
              context: {
                ...row.context,
                qualifier: e.target.value
                  ? (e.target.value as 'primary' | 'secondary' | 'tertiary')
                  : undefined,
              },
            })
          }
        >
          <option value="">None</option>
          <option value="primary">Primary</option>
          <option value="secondary">Secondary</option>
          <option value="tertiary">Tertiary</option>
        </select>
      </label>
    </div>
  );
}
