import type { Audit } from '../lib/contract'

/* ---------------------------------------------------------------------------
   The audit card.

   Not a success badge. A table of what the agent promised, whether it is true,
   and the thing that proves it. A run that says "done" without this card is
   making a claim; this is the claim with its receipts attached.
   --------------------------------------------------------------------------- */

const VERDICT: Record<Audit['verdict'], string> = {
  met: 'met',
  partial: 'partial',
  not_met: 'not met',
}

export function AuditCard({ audit }: { audit: Audit }) {
  const met = audit.items.filter((i) => i.met).length
  const all = audit.items.length
  const clean = audit.verdict === 'met' && met === all

  return (
    <div
      className="rounded-[9px] px-[12px] py-[10px]"
      style={{ border: '1px solid var(--line-3)', background: 'var(--surface)' }}
    >
      <div className="flex items-baseline gap-[8px]">
        <span
          className="mono text-[10px] tracking-[0.08em] uppercase"
          style={{ color: 'var(--text-3)' }}
        >
          audit
        </span>
        <span
          className="mono text-[10.5px]"
          style={{ color: clean ? 'var(--text-2)' : 'var(--text-1)' }}
        >
          {VERDICT[audit.verdict]}
        </span>
        <span className="mono ml-auto text-[10px]" style={{ color: 'var(--text-4)' }}>
          {met}/{all} met
        </span>
      </div>

      <div className="mt-[8px] flex flex-col gap-[6px]">
        {audit.items.map((item, i) => (
          <div key={`${i}-${item.criterion}`} className="flex gap-[7px]">
            <span
              className="mono w-[12px] shrink-0 text-[10.5px] leading-[1.5]"
              style={{ color: item.met ? 'var(--text-2)' : 'var(--text-1)' }}
            >
              {item.met ? '✓' : '×'}
            </span>
            <div className="min-w-0">
              <p
                className="bidi m-0 text-[11.5px] leading-[1.5]"
                style={{ color: item.met ? 'var(--text-2)' : 'var(--text-1)' }}
              >
                {item.criterion}
              </p>
              <p
                className="mono m-0 mt-[1px] text-[10px] leading-[1.5]"
                style={{ color: 'var(--text-4)' }}
              >
                {item.evidence}
              </p>
            </div>
          </div>
        ))}
      </div>

      {audit.note && (
        <p className="m-0 mt-[8px] text-[11px] leading-[1.55]" style={{ color: 'var(--text-3)' }}>
          {audit.note}
        </p>
      )}
    </div>
  )
}
