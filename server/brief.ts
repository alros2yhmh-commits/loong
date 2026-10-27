/* ---------------------------------------------------------------------------
   The brief.

   A person says "make the settings page better". A strong engineer hears a
   different sentence: which settings, better how, for whom, what must not
   break, and how we will know it worked. That translation is the difference
   between an agent that produces something and an agent that produces the
   right thing — and it is exactly what a weak model skips.

   So the translation happens BEFORE the model reads the message: the request
   is compiled into a brief — objective, deliverable, constraints, steps, and
   how it will be verified — and the brief is what the run is asked to satisfy.

   No model call. This is deterministic, so it costs nothing and cannot drift:
   the same words always compile to the same brief, and a simple question
   compiles to a one-line brief that says "answer it, do not build".
   --------------------------------------------------------------------------- */

export type Complexity = 'trivial' | 'small' | 'medium' | 'large'

export interface Brief {
  complexity: Complexity
  /** what the request actually is */
  intent: 'question' | 'explain' | 'build' | 'fix' | 'refactor' | 'review' | 'research' | 'operate'
  /** the one sentence the run must satisfy */
  objective: string
  /** what the reader should be able to do when it is done */
  deliverable: string
  /** things this kind of request must not do */
  constraints: string[]
  /** the shape of the work, when the request is big enough to have a shape */
  steps: string[]
  /** how the run proves it worked */
  verification: string
  /** true when the answer lives on the web, not in the workspace */
  wantsResearch: boolean
  /** true when the request needs a plan before code */
  wantsPlan: boolean
}

const RESEARCH_WORDS =
  /\b(compare|difference between|best practice|latest|2026|release notes|docs?|documentation|api of|vs\.?|benchmark|which (is|one) (better|best)|recommend|should i use|state of the art)\b/i
const BUILD_WORDS =
  /\b(add|build|create|implement|make|write|generate|scaffold|new (page|screen|component|endpoint|feature)|support for)\b/i
const FIX_WORDS = /\b(fix|bug|broken|crash|fails?|error|not working|wrong|regression|flaky)\b/i
const REFACTOR_WORDS = /\b(refactor|clean ?up|rename|extract|simplify|restructure|dedupe|reorganize)\b/i
const REVIEW_WORDS = /\b(review|audit|check|inspect|critique|feedback on|look at)\b/i
const OPERATE_WORDS = /\b(run|deploy|install|commit|push|release|build the|start|stop|open|launch)\b/i
const QUESTION_END = /[?؟]\s*$/
const ARABIC = {
  build: /(?:^|[\s،؛.!؟])(?:اكتب|انشئ|أنشئ|ابن|ابني|اصنع|نفذ|اعمل|أعمل|اضف|أضف|طور|طوّر|عدل|عدّل)(?:[\s،؛.!؟]|$)/u,
  fix: /(?:اصلح|أصلح|اصلاح|إصلاح|خطأ|خطا|عطل|لا يعمل|مش شغال|بيتعطل|ينهار|مشكله|مشكلة)/u,
  review: /(?:افحص|إفحص|راجع|اقرأ|اقرا|قراءة|مراجعة|فحص)/u,
  explain: /^(?:ما هو|ما هي|ماذا|لماذا|كيف|هل|اشرح|اشرحلي|اشرح لي|وضح|يعني ايه|إيه|ايه)(?:\s|$)/u,
  operate: /(?:شغل|شغّل|ثبت|ثبّت|انشر|ارفع|ابدأ التشغيل)/u,
  research: /(?:ابحث|ابحثلي|قارن|مقارنة|مصادر|توثيق رسمي|احدث|أحدث)/u,
  scale: /(?:بالكامل|كامل|كاملة|كل الملفات|كل المشروع|المشروع كله|احترافي|متكامل|متكاملة|جميع)/u,
}
const GREETING = /^(?:hi|hello|hey|thanks|thank you|ok|okay|مرحبا|مرحبًا|اهلا|أهلا|شكرا|شكرًا|تمام)[!.،\s]*$/i
const VAGUE = /\b(better|nicer|improve|polish|modern|clean|good|proper|somehow|maybe|etc\.?)\b/i
const SCALE = /\b(all|every|entire|whole|throughout|across the (app|project|codebase)|everything)\b/i

/** the languages and frameworks a request names, so the brief can name them back */
const STACK =
  /\b(react|next\.?js|vue|svelte|node|express|hono|typescript|javascript|python|go|rust|sql|postgres|sqlite|css|tailwind|electron|remix|astro|django|flask|fastapi|godot|unity)\b/gi

export function compileBrief(message: string): Brief {
  const text = message.trim()
  const lower = text.toLowerCase()
  const words = text.split(/\s+/).length

  const isQuestion = ARABIC.explain.test(text) || QUESTION_END.test(text) || /^(what|why|how|when|where|who|which|is|are|can|does|do|should)\b/i.test(text)
  const wantsResearch = RESEARCH_WORDS.test(lower) || ARABIC.research.test(text)
  const scale = SCALE.test(lower) || ARABIC.scale.test(text)
  const stack = Array.from(new Set((lower.match(STACK) ?? []).map((s) => s.replace(/\.?js$/, ''))))

  const explicitChange = BUILD_WORDS.test(lower) || ARABIC.build.test(text) ||
    /\b(?:fix|repair|resolve|refactor)\b/i.test(text) || /(?:اصلح|أصلح|صلح|صحح|صحّح)/u.test(text)
  const reportOnly = /\b(?:write|produce|give|provide)\s+(?:me\s+)?(?:(?:a|an|the)\s+)?(?:report|review|explanation)\b|(?:اكتب|قدم|قدّم)\s+(?:تقرير|شرح|مراجعة)/i.test(text)
  const reviewOnly = /(?:do not (?:edit|change|write)|without (?:editing|changing)|read.only|لا (?:تغير|تغيّر|تعدل|تعدّل|تكتب)|بدون تعديل)/i.test(text)
  let intent: Brief['intent'] = 'build'
  if (GREETING.test(text)) intent = 'question'
  else if (reviewOnly || reportOnly || ((REVIEW_WORDS.test(lower) || ARABIC.review.test(text)) && !explicitChange)) intent = 'review'
  else if (isQuestion && !explicitChange) intent = wantsResearch ? 'research' : 'explain'
  else if (FIX_WORDS.test(lower) || ARABIC.fix.test(text)) intent = 'fix'
  else if (REFACTOR_WORDS.test(lower)) intent = 'refactor'
  else if (REVIEW_WORDS.test(lower) || (ARABIC.review.test(text) && !ARABIC.build.test(text))) intent = 'review'
  else if (BUILD_WORDS.test(lower) || ARABIC.build.test(text)) intent = 'build'
  else if (OPERATE_WORDS.test(lower) || ARABIC.operate.test(text)) intent = 'operate'
  else if (isQuestion) intent = wantsResearch ? 'research' : 'explain'
  else if (wantsResearch && words < 40) intent = 'research'

  /* size: what the request costs to do, not how it was typed */
  let complexity: Complexity = 'small'
  if (words > 220 || scale) complexity = 'large'
  else if (words > 90 || (intent === 'refactor' && scale)) complexity = 'medium'
  if (words < 12 && !scale) complexity = 'trivial'
  if (intent === 'explain' || intent === 'research' || intent === 'question') complexity = words > 120 ? 'medium' : 'trivial'
  /* a crash is never small, however briefly it was reported */
  if (intent === 'fix' && /\b(crash(es|ed|ing)?|data ?loss|corrupt(ed|ion)?|security|leak(s|ing)?)\b/i.test(lower))
    complexity = 'large'

  const constraints: string[] = []
  if (VAGUE.test(lower))
    constraints.push(
      'The request is vague on purpose or by accident: pick the most defensible reading, say which one you picked in one line, and do not ask a question first.',
    )
  if (stack.length > 0) constraints.push(`Stay inside the stack the request names: ${stack.join(', ')}.`)
  constraints.push('Match the surrounding code — its names, its error handling, its comment voice. New patterns need a reason.')
  constraints.push('No placeholders, no "TODO", no invented APIs. If something cannot be done, say so plainly.')

  const steps: string[] = []
  if (complexity === 'large' || complexity === 'medium') {
    if (intent === 'fix') {
      steps.push('Reproduce it — a failing test, a command, or the exact steps.')
      steps.push('Find the cause, not the symptom; say what the cause is before touching it.')
      steps.push('Fix the cause, then prove the reproduction now passes.')
      steps.push('Check the neighbours: the same bug usually exists twice.')
    } else if (intent === 'refactor') {
      steps.push('Read the whole unit before changing a line (outline first, then the parts you touch).')
      steps.push('Move in small, behaviour-preserving steps; keep the tests green between them.')
      steps.push('Delete what the refactor orphaned.')
    } else if (intent === 'review') {
      steps.push('Read the code, not the description of it.')
      steps.push('Report findings by severity with file:line; say what is fine only when it is not obvious.')
      steps.push('Do not change anything unless asked — a review is a report.')
    } else if (intent === 'research') {
      steps.push('Search first; read the primary source, not a summary of it.')
      steps.push('Answer in the reader\'s context, with the version they are on.')
      steps.push('Say what is uncertain, and what you did not check.')
    } else {
      steps.push('Read the files this touches before writing any of them.')
      steps.push('Build the smallest complete version; wire it end to end before adding options.')
      steps.push('Verify: typecheck, the tests that exist, and one run of the thing.')
    }
  }

  const verification =
    intent === 'research' || intent === 'explain'
      ? 'The answer stands on sources you actually read, and says what it does not know.'
      : intent === 'review'
        ? 'Every finding has a file and a line, and a severity.'
        : 'It compiles (or parses), the existing tests still pass, and the specific behaviour asked for was exercised once.'

  return {
    complexity,
    intent,
    objective: text,
    deliverable:
      intent === 'explain' || intent === 'research'
        ? 'A direct answer, in the reader\'s terms, as long as it needs to be and no longer.'
        : intent === 'review'
          ? 'A report: what is wrong, where, how bad, and what to do about it.'
          : 'Working code in the workspace, wired in, with the change described in one line.',
    constraints,
    steps,
    verification,
    wantsResearch,
    wantsPlan: (complexity === 'large' || (complexity === 'medium' && intent !== 'fix')) &&
      !/\b(?:no plan|without (?:a )?plan(?:ning)?|skip (?:the )?plan)\b|(?:بدون (?:خطة|تخطيط)|لا (?:تكتب|تعمل|تضع) خطة)/i.test(text),
  }
}

/** the block the prompt carries — short for a small ask, a contract for a big one */
export function briefBlock(brief: Brief): string {
  if (brief.complexity === 'trivial' && brief.intent !== 'build' && brief.intent !== 'fix') {
    return `\n\n--- THE REQUEST (compiled) ---\nIntent: ${brief.intent}. It is small: answer it directly and stop. No plan, no ceremony, no files unless the answer is code.`
  }
  const lines = [
    `Intent: ${brief.intent} · size: ${brief.complexity}`,
    `Objective: ${brief.objective}`,
    `Deliverable: ${brief.deliverable}`,
    brief.constraints.length ? `Constraints:\n${brief.constraints.map((c) => `- ${c}`).join('\n')}` : '',
    brief.steps.length ? `Shape of the work:\n${brief.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    `Proof: ${brief.verification}`,
    brief.wantsResearch
      ? 'This one lives partly outside the workspace: search before you answer, and cite what you read.'
      : '',
    brief.wantsPlan ? 'This is big enough to plan: write the plan before the first edit.' : '',
  ].filter(Boolean)
  return `\n\n--- THE REQUEST (compiled) ---\n${lines.join('\n')}\n--- end request ---`
}
