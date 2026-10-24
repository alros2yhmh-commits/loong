import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { UiWidget, UI_TYPES } from './Widgets'

/* ---------------------------------------------------------------------------
   Rich text — real markdown.

   The hand-rolled bold/inline-code parser could not render the three things an
   agent answer actually needs: tables (a comparison), lists (a plan of attack),
   and fenced code. react-markdown + GFM does all three, sanitised so model
   output can never inject script. Everything is mapped back to the monochrome
   ramp — the answer is the page, not a syntax-highlighted rainbow.
   --------------------------------------------------------------------------- */

const inlineCode = {
  background: 'var(--surface-sunken)',
  border: '1px solid var(--line-1)',
  color: 'var(--text-2)',
} as const

export function RichText({ text }: { text: string }) {
  return (
    <div className="md" dir="auto">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: (p: any) => (
            <p dir="auto" className="bidi m-0 mt-[0.72em] first:mt-0">
              {p.children}
            </p>
          ),
          a: (p: any) => (
            <a
              href={p.href}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--text-1)', textDecoration: 'underline', textUnderlineOffset: 2 }}
            >
              {p.children}
            </a>
          ),
          code: (p: any) => {
            const block = typeof p.className === 'string' && p.className.includes('language-')
            if (block) {
              return (
                <code dir="ltr" className="mono block text-[11.5px] leading-[1.6]" style={{ color: 'var(--text-2)' }}>
                  {p.children}
                </code>
              )
            }
            return (
              <code dir="ltr" className="mono rounded-[3px] px-[3px] py-[1px] text-[0.92em]" style={inlineCode}>
                {p.children}
              </code>
            )
          },
          pre: (p: any) => {
            const child = Array.isArray(p.children) ? p.children[0] : p.children
            const cls = typeof child?.props?.className === 'string' ? child.props.className : ''
            /* a ```ui block is an Intelligent-UI widget, not code */
            if (/language-(ui|widget)\b/.test(cls)) {
              const raw = child?.props?.children
              const body = Array.isArray(raw) ? raw.join('') : typeof raw === 'string' ? raw : ''
              try {
                const spec = JSON.parse(body)
                if (spec && UI_TYPES.has(String(spec.type))) return <UiWidget spec={spec} />
              } catch {
                /* malformed JSON falls through to a normal code block */
              }
            }
            return (
              <pre
                dir="ltr"
                className="mono mt-[0.6em] mb-[0.2em] overflow-auto rounded-[6px] px-[10px] py-[8px] text-[11.5px] leading-[1.6]"
                style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line-2)', whiteSpace: 'pre' }}
              >
                {p.children}
              </pre>
            )
          },
          table: (p: any) => (
            <div className="my-[0.7em] w-full overflow-x-auto">
              <table className="w-full border-collapse text-[0.94em]">{p.children}</table>
            </div>
          ),
          th: (p: any) => (
            <th
              className="px-[9px] py-[6px] text-left text-[0.95em]"
              style={{ borderBottom: '1px solid var(--line-4)', color: 'var(--text-1)', fontWeight: 500 }}
            >
              {p.children}
            </th>
          ),
          td: (p: any) => (
            <td
              className="px-[9px] py-[6px] align-top"
              style={{ borderBottom: '1px solid var(--line-1)', color: 'var(--text-2)' }}
            >
              {p.children}
            </td>
          ),
          ul: (p: any) => (
            <ul className="m-0 mt-[0.5em] list-disc pr-[1.2em] pl-[1.2em]" style={{ color: 'var(--text-2)' }}>
              {p.children}
            </ul>
          ),
          ol: (p: any) => (
            <ol className="m-0 mt-[0.5em] list-decimal pr-[1.2em] pl-[1.2em]" style={{ color: 'var(--text-2)' }}>
              {p.children}
            </ol>
          ),
          li: (p: any) => (
            <li dir="auto" className="bidi my-[0.15em] leading-[1.62]">
              {p.children}
            </li>
          ),
          h1: (p: any) => (
            <h1 className="display m-0 mt-[0.9em] mb-[0.2em] text-[1.15em]" style={{ color: 'var(--text-1)' }}>
              {p.children}
            </h1>
          ),
          h2: (p: any) => (
            <h2 className="display m-0 mt-[0.85em] mb-[0.2em] text-[1.08em]" style={{ color: 'var(--text-1)' }}>
              {p.children}
            </h2>
          ),
          h3: (p: any) => (
            <h3 className="m-0 mt-[0.8em] mb-[0.15em] text-[1.02em]" style={{ color: 'var(--text-1)', fontWeight: 500 }}>
              {p.children}
            </h3>
          ),
          blockquote: (p: any) => (
            <blockquote
              className="m-0 mt-[0.6em] py-[1px] pl-[11px]"
              style={{ borderLeft: '2px solid var(--line-3)', color: 'var(--text-3)' }}
            >
              {p.children}
            </blockquote>
          ),
          hr: () => <hr className="my-[0.9em]" style={{ border: 0, borderTop: '1px solid var(--line-2)' }} />,
          img: (p: any) => (
            <img
              src={p.src}
              alt={p.alt ?? ''}
              className="my-[0.5em] block max-h-[340px] max-w-full rounded-[7px] object-contain"
              style={{ border: '1px solid var(--line-2)' }}
            />
          ),
          strong: (p: any) => <strong style={{ fontWeight: 500, color: 'var(--text-1)' }}>{p.children}</strong>,
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
