import type { Catalog, CopyRecord, DraftRow, LayerInfo, Locale } from '@string-binder/contracts';
import { canvasFingerprint, canvasLocale, productLabel, ROLE_LIST } from '@string-binder/domain';
import { useId } from 'react';
import { canvasChanged, composeErrors, keyPreview } from './model';

const QUALIFIERS = ['primary', 'secondary', 'tertiary'] as const;

/** `feature › screen › context` as one editable line. */
const pathOf = (row: DraftRow) =>
  [row.context.feature, row.context.screen, row.context.context].filter(Boolean).join(' › ');

function parsePath(value: string): Pick<DraftRow['context'], 'feature' | 'screen' | 'context'> {
  const [feature = '', screen = '', ...rest] = value.split(/\s*[›>]\s*/u);
  return { feature: feature.trim(), screen: screen.trim(), context: rest.join(' ').trim() };
}

const TITLES: Record<DraftRow['action'], string> = {
  create: 'New copy',
  edit: 'Edit copy everywhere',
  variant: 'Variant for this screen',
  reuse: 'Restore saved copy',
  keep: '',
};

export function ComposeForm(props: {
  row: DraftRow;
  layer: LayerInfo;
  catalog: Catalog;
  disabled: boolean;
  /** Saved copy with the same EN and ID in this product or Shared. */
  duplicates: readonly CopyRecord[];
  onChange: (update: Partial<DraftRow>) => void;
  onUseExisting: (record: CopyRecord) => void;
  onCancel: () => void;
}) {
  const { row, layer, catalog, disabled, onChange } = props;
  const id = useId();
  const errors = row.en || row.id ? composeErrors(row, catalog.products) : [];
  const key = row.action === 'edit' ? row.baseline?.platformKey : keyPreview(row, catalog.products);
  const roles: readonly string[] = ROLE_LIST;
  const setLocale = (locale: Locale) => onChange(canvasLocale(row, locale, layer.characters));

  return (
    <div className="compose" role="group" aria-label={TITLES[row.action]}>
      <div className="compose__head">
        <span className="eyebrow">{TITLES[row.action]}</span>
        {row.product && <span className="chip chip--static">{productLabel(row.product)}</span>}
        <span className="spacer" />
        <span className="segmented segmented--text" role="group" aria-label="Canvas language">
          <span className="segmented__label">Canvas is</span>
          {(['id', 'en'] as const).map((locale) => (
            <button
              key={locale}
              type="button"
              aria-pressed={row.locale === locale}
              disabled={disabled}
              onClick={() => setLocale(locale)}
            >
              {locale.toUpperCase()}
            </button>
          ))}
        </span>
      </div>

      {row.action === 'edit' && (
        <p className="compose__warning">
          Changes this copy on every screen that uses it. For this screen only, make a variant.
        </p>
      )}
      {canvasChanged(row, layer) && (
        <p className="compose__warning">
          Canvas text changed since you started.{' '}
          <button
            type="button"
            className="link-button"
            disabled={disabled}
            onClick={() =>
              onChange({
                [row.locale]: layer.characters,
                canvasText: layer.characters,
                canvasFingerprint: canvasFingerprint(layer),
              })
            }
          >
            Use the new canvas text
          </button>
        </p>
      )}

      <label className="compose__field" htmlFor={`${id}-en`}>
        <span className="locale-label">EN</span>
        <textarea
          id={`${id}-en`}
          rows={2}
          value={row.en}
          disabled={disabled}
          placeholder="English copy"
          onChange={(event) => onChange({ en: event.target.value })}
        />
      </label>
      <label className="compose__field" htmlFor={`${id}-id`}>
        <span className="locale-label">ID</span>
        <textarea
          id={`${id}-id`}
          rows={2}
          value={row.id}
          disabled={disabled}
          placeholder="Bahasa Indonesia copy"
          onChange={(event) => onChange({ id: event.target.value })}
        />
      </label>

      <div className="compose__grid">
        <label>
          <span className="compose__label">Role</span>
          <select
            value={row.context.role}
            disabled={disabled}
            onChange={(event) =>
              onChange({ context: { ...row.context, role: event.target.value } })
            }
          >
            {!roles.includes(row.context.role) && (
              <option value={row.context.role}>{row.context.role}</option>
            )}
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="compose__label">Screen path</span>
          <input
            value={pathOf(row)}
            disabled={disabled}
            placeholder="feature › screen › context"
            onChange={(event) =>
              onChange({ context: { ...row.context, ...parsePath(event.target.value) } })
            }
          />
        </label>
      </div>

      <details className="compose__more">
        <summary>More details</summary>
        <div className="compose__grid">
          <label>
            <span className="compose__label">Qualifier</span>
            <select
              value={row.context.qualifier ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  context: {
                    ...row.context,
                    qualifier: (event.target.value ||
                      undefined) as DraftRow['context']['qualifier'],
                  },
                })
              }
            >
              <option value="">None</option>
              {QUALIFIERS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="compose__label">Note for developers</span>
            <input
              value={row.context.note}
              disabled={disabled}
              onChange={(event) =>
                onChange({ context: { ...row.context, note: event.target.value } })
              }
            />
          </label>
        </div>
      </details>

      <p className="compose__key">
        <span className="compose__label">Key</span>
        <span className="mono">{key || '—'}</span>
        {row.action !== 'edit' && key && <span className="compose__hint">may get a suffix</span>}
      </p>

      {errors.length > 0 && (
        <ul className="compose__errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      {props.duplicates.length > 0 && row.action !== 'edit' && (
        <div className="compose__duplicates">
          <span className="compose__label">Already saved with the same EN and ID</span>
          {props.duplicates.map((record) => (
            <div className="duplicate" key={record.copyId}>
              <span className="duplicate__body">
                <span className="mono">{record.platformKey}</span>
                <span className="duplicate__path">
                  {[productLabel(record.product), record.context.feature, record.context.screen]
                    .filter(Boolean)
                    .join(' › ')}
                </span>
              </span>
              <button
                type="button"
                className="button button--secondary"
                disabled={disabled}
                onClick={() => props.onUseExisting(record)}
              >
                Use this
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="compose__actions">
        <button type="button" className="link-button" disabled={disabled} onClick={props.onCancel}>
          {row.action === 'create' ? 'Discard new copy' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
