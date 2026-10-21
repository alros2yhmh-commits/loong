import type { AgentEvent, ApprovalDecision, Session } from './contract'

/* ---------------------------------------------------------------------------
   A recorded run.

   This is not a fake backend. It is a fixture: the exact event shapes the real
   runtime will emit, with realistic timing, so the interface can be designed
   and judged before the engine exists. Swapping it for the real thing is a
   one-file change — the UI never learns the difference.

   The run forks at the approval. Steps tagged with a branch are skipped when
   the human decided the other way, which is what lets the fixture answer
   "what happens if I say no" without a second script.
   --------------------------------------------------------------------------- */

export interface Step {
  /** ms to wait after the previous step */
  delay: number
  event: AgentEvent
  /** only run when the human's decision matched. unset means always. */
  branch?: ApprovalDecision
}

const t = (n: number) => 1_700_000_000_000 + n
let n = 0
const id = (p: string) => `${p}${(n += 1)}`

/** a realistic file dump — long enough that the interface has to clamp it */
const HOOK_DUMP = [
  '  1  import { useCallback, useEffect, useRef, useState } from "react"',
  '  2',
  '  3  export interface EdgeRevealOptions {',
  '  4    zone?: number',
  '  5    width?: number',
  '  6    grace?: number',
  '  7  }',
  '  8',
  '  9  export function useEdgeReveal({',
  ' 10    zone = 4,',
  ' 11    width = 320,',
  ' 12    grace = 620,',
  ' 13  }: EdgeRevealOptions = {}) {',
  ' 14    const [open, setOpen] = useState(false)',
  ' 15    const [pinned, setPinned] = useState(false)',
  ' 16    const [hot, setHot] = useState(false)',
  ' 17',
  ' 18    const openRef = useRef(open)',
  ' 19    const pinnedRef = useRef(pinned)',
  ' 20    const closeTimer = useRef<number | null>(null)',
  ' 21    const openTimer = useRef<number | null>(null)',
  ' 22',
  ' 23    openRef.current = open',
  ' 24    pinnedRef.current = pinned',
  ' 25',
  ' 26    const cancel = (ref: React.MutableRefObject<number | null>) => {',
  ' 27      if (ref.current !== null) {',
  ' 28        window.clearTimeout(ref.current)',
  ' 29        ref.current = null',
  ' 30      }',
  ' 31    }',
  ' 32',
  ' 33    const reveal = useCallback(() => {',
  ' 34      cancel(closeTimer)',
  ' 35      setHot(true)',
  ' 36      if (openRef.current) return',
  ' 37      cancel(openTimer)',
  ' 38      openTimer.current = window.setTimeout(() => setOpen(true), 110)',
  ' 39    }, [])',
  ' 40',
  ' 41    const scheduleClose = useCallback(() => {',
  ' 42      cancel(openTimer)',
  ' 43      setHot(false)',
  ' 44      if (pinnedRef.current) return',
  ' 45      cancel(closeTimer)',
  ' 46      closeTimer.current = window.setTimeout(() => setOpen(false), grace)',
  ' 47    }, [grace])',
  ' 48',
  ' 49    useEffect(() => {',
  ' 50      const onMove = (e: MouseEvent) => {',
  ' 51        const w = window.innerWidth',
  ' 52        const inZone = e.clientX >= w - zone',
  ' 53        const inPanel = openRef.current && e.clientX >= w - width - 8',
  ' 54        if (inZone || inPanel) reveal()',
  ' 55        else scheduleClose()',
  ' 56      }',
  ' 57      window.addEventListener("mousemove", onMove)',
  ' 58      return () => window.removeEventListener("mousemove", onMove)',
  ' 59    }, [zone, width, reveal, scheduleClose])',
  ' 60',
  ' 61    return { open, pinned, setPinned, hot, zone }',
  ' 62  }',
].join('\n')

export function buildRun(): Step[] {
  n = 0
  const steps: Step[] = []
  const push = (
    delay: number,
    event: AgentEvent,
    branch?: ApprovalDecision,
  ) => steps.push({ delay, event, branch })

  push(300, { kind: 'session', at: t(0), id: 's1', title: 'Fix the drawer hit zone' })

  push(700, {
    kind: 'user',
    at: t(1),
    id: 'u1',
    text:
      'The right drawer keeps opening while I am selecting text near the edge. ' +
      'It should only wake up when the pointer is actually against the bezel. ' +
      'Have a look and fix it.',
  })

  push(520, {
    kind: 'thinking',
    at: t(2),
    id: id('th'),
    text: 'Two candidates: the hot zone is too wide, or the mouseleave handler is not firing. Checking the hook first.',
  })

  const grepCall = id('c')
  push(640, {
    kind: 'tool_call',
    at: t(3),
    call: {
      id: grepCall,
      tool: 'grep',
      title: 'edge reveal · src',
      input: { pattern: 'EDGE_ZONE|useEdgeReveal', path: 'src' },
    },
  })

  push(760, {
    kind: 'tool_result',
    at: t(4),
    result: {
      id: grepCall,
      ok: true,
      ms: 312,
      output:
        'src/hooks/useEdgeReveal.ts:8:  const EDGE_ZONE = 24\n' +
        'src/hooks/useEdgeReveal.ts:41:  if (e.clientX >= innerWidth - EDGE_ZONE) open()\n' +
        'src/App.tsx:52:  const drawer = useEdgeReveal({ zone: 24 })',
    },
  })

  push(430, {
    kind: 'thinking',
    at: t(5),
    id: id('th'),
    text: 'A 24px zone on a 2560px display is roughly one percent of the width. That is wide enough to catch a text drag. Reading the whole hook.',
  })

  const readCall = id('c')
  push(560, {
    kind: 'tool_call',
    at: t(6),
    call: {
      id: readCall,
      tool: 'read_file',
      title: 'src/hooks/useEdgeReveal.ts',
      input: { path: 'src/hooks/useEdgeReveal.ts', lines: '1-62' },
    },
  })

  push(690, {
    kind: 'tool_result',
    at: t(7),
    result: { id: readCall, ok: true, ms: 88, output: HOOK_DUMP },
  })

  const testCall1 = id('c')
  push(520, {
    kind: 'tool_call',
    at: t(8),
    call: {
      id: testCall1,
      tool: 'shell',
      title: 'npm run test:hooks',
      input: { cmd: 'npm run test:hooks -- --grep edge' },
    },
  })

  push(1450, {
    kind: 'tool_result',
    at: t(9),
    result: {
      id: testCall1,
      ok: false,
      ms: 1310,
      output:
        '✗ edge reveal closes while the pointer is still inside the panel\n' +
        '  expected open to be true, received false\n' +
        '  1 failing, 6 passing',
    },
  })

  push(400, {
    kind: 'error',
    at: t(10),
    id: id('e'),
    message: 'Test suite is red before any change',
    detail:
      'The failure is real and predates the fix: GRACE (420ms) is shorter than the drawer spring (roughly 560ms to settle), so the panel is still animating in when the close timer fires.',
  })

  push(700, {
    kind: 'thinking',
    at: t(11),
    id: id('th'),
    text: 'So there are two bugs, not one. The zone is too wide, and the grace period is shorter than the panel animation. The second one needs a write, so I will ask first.',
  })

  /* ---- the fork. nothing below runs until a human decides. ---- */
  const approvalId = id('a')
  push(620, {
    kind: 'approval',
    at: t(12),
    request: {
      id: approvalId,
      tool: 'write_file',
      title: 'src/hooks/useEdgeReveal.ts',
      detail:
        'EDGE_ZONE 24 → 4, GRACE 420 → 620. Two constants, no logic change. Reversible with git checkout.',
    },
  })

  const writeCall = id('c')
  push(
    420,
    {
      kind: 'tool_call',
      at: t(13),
      call: {
        id: writeCall,
        tool: 'write_file',
        title: 'src/hooks/useEdgeReveal.ts',
        input: {
          path: 'src/hooks/useEdgeReveal.ts',
          diff: '- const EDGE_ZONE = 24\n- const GRACE = 420\n+ const EDGE_ZONE = 4\n+ const GRACE = 620',
        },
      },
    },
    'approve',
  )

  push(
    880,
    {
      kind: 'tool_result',
      at: t(14),
      result: {
        id: writeCall,
        ok: true,
        ms: 74,
        output: 'src/hooks/useEdgeReveal.ts  +2 -2',
      },
    },
    'approve',
  )

  const testCall2 = id('c')
  push(
    560,
    {
      kind: 'tool_call',
      at: t(15),
      call: {
        id: testCall2,
        tool: 'shell',
        title: 'npm run test:hooks',
        input: { cmd: 'npm run test:hooks -- --grep edge' },
      },
    },
    'approve',
  )

  push(
    1180,
    {
      kind: 'tool_result',
      at: t(16),
      result: {
        id: testCall2,
        ok: true,
        ms: 1042,
        output: '✓ 7 passing\n  0 failing',
      },
    },
    'approve',
  )

  const approvedMsg = [
    ['Two separate problems, ', 420],
    ['and only one of them was ', 38],
    ['the one you described.\n\n', 41],
    ['**The hot zone.** ', 36],
    ['24 px is about one percent ', 34],
    ['of a 2560 px display, so a ', 39],
    ['drag that ends near the ', 35],
    ['bezel trips it. It is now 4 px.\n\n', 40],
    ['**The grace period.** ', 37],
    ['This one was already broken ', 33],
    ['and the suite was red before ', 42],
    ['I touched anything. The close ', 36],
    ['timer fired at 420 ms while the ', 38],
    ['panel still needed about 560 ms ', 35],
    ['to settle, so it dismissed itself mid-flight.\n\n', 40],
    ['**Why the second one is worse than it looks.** ', 36],
    ['A panel that closes while it is still opening is not a timing nuisance, it is a ' +
      'correctness problem, because the close handler runs against a component that has ' +
      'not finished mounting. That is why the suite caught it and the manual test did not: ' +
      'a human clicking around will never hold the pointer still for the exact 420 ms window ' +
      'where the two animations overlap. It only shows up when the machine is slow, which ' +
      'means it shows up on somebody else\u2019s laptop and never on yours.\n\n', 34],
    ['Both fixed. Seven passing, none failing.\n\n', 36],
    ['**What I did not do.** ', 36],
    ['I left the reveal delay, the panel spring and the pointer-tracking handler alone. ' +
      'None of them are implicated, and changing them would make this diff harder to ' +
      'review for no gain. I also did not add the regression test below.\n\n', 38],
    ['**The shape of the real bug.** ', 36],
    ['Two constants have to agree with each other and nothing enforces that they do. ' +
      'GRACE has to outlast the spring, and both of them are hard-coded numbers in ' +
      'different files. That is why this survived review: each number is defensible on ' +
      'its own, and the defect only exists in the relationship between them.\n\n', 38],
    ['**If it comes back.** ', 36],
    ['The symptom is the panel closing while the pointer is still inside it. The fix ' +
      'is not a bigger number, it is reading the spring duration instead of restating ' +
      'it, so the two can never drift apart again. I would like to land that, plus a ' +
      'test that pins the relationship, but it is a separate change and I did not want ' +
      'to bundle it into a fix you asked for by name.', 38],
  ] as const

  let stamp = 17
  for (const [text, delay] of approvedMsg) {
    push(delay, { kind: 'token', at: t(stamp++), id: 'm1', text: text as string }, 'approve')
  }
  push(260, { kind: 'message', at: t(stamp++), id: 'm1', text: '' }, 'approve')
  push(320, { kind: 'done', at: t(stamp++), id: id('d') }, 'approve')

  /* ---- the other branch: the human said no ---- */
  push(
    360,
    {
      kind: 'thinking',
      at: t(30),
      id: id('th'),
      text: 'Understood — no write. Leaving the file untouched.',
    },
    'deny',
  )

  const deniedMsg = [
    ['Stopped before touching anything. ', 380],
    ['`src/hooks/useEdgeReveal.ts` is exactly as I found it.\n\n', 36],
    ['For the record, the diagnosis still stands: the hot zone is too wide at 24 px, ' +
      'and the grace period is shorter than the drawer spring, so the panel dismisses ' +
      'itself mid-flight. Neither is fixed, and the test suite is still red.\n\n', 38],
    ['When you want to come back to it, the change is two constants.', 36],
  ] as const

  let denyStamp = 31
  for (const [text, delay] of deniedMsg) {
    push(delay, { kind: 'token', at: t(denyStamp++), id: 'm2', text: text as string }, 'deny')
  }
  push(260, { kind: 'message', at: t(denyStamp++), id: 'm2', text: '' }, 'deny')
  push(320, { kind: 'done', at: t(denyStamp++), id: id('d') }, 'deny')

  return steps
}

export const SESSIONS: Session[] = [
  {
    id: 's1',
    title: 'Fix the drawer hit zone',
    preview: 'Two separate problems, and only one of them was the one you described.',
    age: 'now',
    pinned: true,
  },
  {
    id: 's2',
    title: 'Engraved texture primitives',
    preview: 'Guilloche field is generated, not imported. Twelve stops on the ramp.',
    age: '12m',
    pinned: true,
  },
  {
    id: 's3',
    title: 'Sound palette, tier 2',
    preview: 'tool start and tool done are too close in pitch to tell apart.',
    age: '1h',
  },
  {
    id: 's4',
    title: 'Composer: cancel mid-stream',
    preview: 'Stop has to be reachable without moving the pointer.',
    age: '3h',
  },
  {
    id: 's5',
    title: 'Thread virtualisation',
    preview: 'Ten thousand messages, and the frame budget still holds.',
    age: 'yesterday',
  },
  {
    id: 's6',
    title: 'Tool card collapse state',
    preview: 'Remember per tool, not per card.',
    age: 'yesterday',
  },
  {
    id: 's7',
    title: 'Contrast audit, light theme',
    preview: 'text-3 on surface-sunken lands at 4.1:1. Needs to be 4.5.',
    age: '2d',
  },
  {
    id: 's8',
    title: 'Package for Windows',
    preview: 'Tauri bundle, signed, 6.8 MB.',
    age: '4d',
  },
]
