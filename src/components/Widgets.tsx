/* ---------------------------------------------------------------------------
   Generated UI blocks.

   ChatGPT 2026's "Intelligent UI" lets the model answer with a small interface
   instead of a wall of text. Loong does the same thing, but in its own language:
   the model emits one fenced ```ui block of JSON, and this renders a compact,
   monochrome widget — a comparison, a table, a bar chart, a checklist, a callout.

   Deliberately:
   - NO animation. Nothing here can hang or jank a long thread.
   - text-only, no HTML injection, rows capped so a huge answer cannot bloat the DOM.
   - unknown shapes render nothing, so RichText can fall back to a code block.
   --------------------------------------------------------------------------- */

const MAX_ROWS = 40

function t(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

export const UI_TYPES = new Set(['compare', 'table', 'chart', 'steps', 'callout'])

export function UiWidget({ spec }: { spec: unknown }) {
  const s = (spec ?? {}) as Record<string, unknown>
  const type = t(s.type)
  if (!UI_TYPES.has(type)) return null

  const title =
    typeof s.title === 'string' && s.title ? (
      <p
        className="mono m-0 mb-[7px] text-[10px] tracking-[0.08em] uppercase"
        style={{ color: 'var(--text-4)' }}
      >
        {s.title}
      </p>
    ) : null

  if (type === 'compare' || type === 'table') {
    const head: string[] =
      type === 'compare'
        ? Array.isArray(s.columns)
          ? (s.columns as unknown[]).map(t)
          : []
        : Array.isArray(s.head)
          ? (s.head as unknown[]).map(t)
          : []
    const rows: unknown[] = Array.isArray(s.rows) ? s.rows : []
    return (
      <div
        className="my-[0.65em] w-full overflow-x-auto rounded-[8px]"
        style={{ border: '1px solid var(--line-2)' }}
      >
        {title && <div className="px-[10px] pt-[8px]">{title}</div>}
        <table className="w-full border-collapse text-[0.94em]">
          {head.length > 0 && (
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th
                    key={i}
                    className="px-[9px] py-[6px] text-left"
                    style={{ borderBottom: '1px solid var(--line-4)', color: 'var(--text-1)', fontWeight: 500 }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r, ri) => {
              const cells = Array.isArray(r) ? r : [r]
              return (
                <tr key={ri}>
                  {cells.map((c, ci) => (
                    <td
                      key={ci}
                      className="px-[9px] py-[6px] align-top"
                      style={{ borderBottom: '1px solid var(--line-1)', color: 'var(--text-2)' }}
                    >
                      {t(c)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  if (type === 'chart') {
    const data = Array.isArray(s.data) ? (s.data as Record<string, unknown>[]) : []
    const unit = typeof s.unit === 'string' ? s.unit : ''
    const max = Math.max(1, ...data.map((d) => Number(d?.value) || 0))
    return (
      <div
        className="my-[0.65em] rounded-[8px] px-[11px] py-[9px]"
        style={{ border: '1px solid var(--line-2)' }}
      >
        {title}
        {data.slice(0, MAX_ROWS).map((d, i) => {
          const v = Number(d?.value) || 0
          return (
            <div key={i} className="mb-[5px]">
              <div className="mono flex justify-between gap-[8px] text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                <span className="truncate">{t(d?.label)}</span>
                <span className="shrink-0">
                  {v}
                  {unit}
                </span>
              </div>
              <div className="mt-[2px] h-[4px] w-full overflow-hidden rounded-full" style={{ background: 'var(--line-1)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.round((v / max) * 100)}%`, background: 'var(--line-5)' }}
                />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (type === 'steps') {
    const items = Array.isArray(s.items) ? s.items : []
    return (
      <div
        className="my-[0.65em] rounded-[8px] px-[11px] py-[9px]"
        style={{ border: '1px solid var(--line-2)' }}
      >
        {title}
        <ol className="m-0 list-none p-0">
          {items.slice(0, MAX_ROWS).map((it, i) => (
            <li key={i} className="mb-[4px] flex gap-[8px] text-[0.94em]" style={{ color: 'var(--text-2)' }}>
              <span className="mono shrink-0" style={{ color: 'var(--text-4)' }}>
                {i + 1}
              </span>
              <span dir="auto" className="bidi">
                {t(it)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  /* callout */
  return (
    <div
      className="my-[0.65em] rounded-[8px] px-[11px] py-[9px]"
      style={{ border: '1px solid var(--line-3)', borderLeft: '2px solid var(--line-5)' }}
    >
      {typeof s.title === 'string' && s.title && (
        <p className="m-0 mb-[3px] text-[0.95em]" style={{ color: 'var(--text-1)', fontWeight: 500 }}>
          {s.title}
        </p>
      )}
      <p dir="auto" className="bidi m-0 text-[0.94em] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
        {t(s.text)}
      </p>
    </div>
  )
}
