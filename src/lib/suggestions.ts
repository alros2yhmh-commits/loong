/* ---------------------------------------------------------------------------
   Composer predictions.

   A cheap, local suggestion of what to ask next, read from the last answer —
   the ChatGPT "suggested follow-up" idea, without spending a model call. Pure
   and testable; the composer renders the result as small chips.
   --------------------------------------------------------------------------- */

export function suggestionsFor(
  lastAssistant: string,
  opts: { running?: boolean; mode?: 'ask' | 'plan' | 'agent' } = {},
): string[] {
  if (opts.running) return []
  const t = (lastAssistant ?? '').toLowerCase()
  if (!t.trim()) return []
  const out: string[] = []
  const add = (s: string) => {
    if (out.length < 3 && !out.includes(s)) out.push(s)
  }

  if (/\b(test|tests|spec|jest|vitest|pytest)\b/.test(t)) add('Run the tests and fix any failures')
  if (/\b(diff|changed|edited|updated|modified|wrote|file)\b/.test(t)) add('Show me the diff of what changed')
  if (/\b(error|failed|exception|stack|crash)\b/.test(t)) add('Explain the error and the fix')
  if (/\b(component|page|ui|design|layout|screen)\b/.test(t)) add('Screenshot the page and check the design')
  if (/\b(commit|git|branch|pull request|pr)\b/.test(t)) add('Commit this with a clear message')
  if (/\b(plan|steps|next|todo)\b/.test(t)) add('What is the next step?')

  if (out.length === 0) add('Explain what you changed')
  return out.slice(0, 3)
}
