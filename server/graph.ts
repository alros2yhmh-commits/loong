import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, relative, dirname, sep } from 'node:path'
import { DATA_DIR, displayPath, getWorkspace, resolveInside } from './config.ts'

/* ---------------------------------------------------------------------------
   Graphify — the repository as a graph, not as a pile of files.

   The failure this exists for: a run that re-reads the same twelve files on
   every cycle, because "where is this used?" is answered by grepping from
   scratch. A graph answers it once and answers it cheaply afterwards.

   What is stored: every source file (path, size, mtime), the symbols it
   declares, and the files it imports — resolved to real workspace paths where
   the import is relative, kept as an external name where it is a package.
   From that: neighbours, transitive impact, and import cycles.

   No native module. The session store learned that lesson already: Electron's
   Node has no `node:sqlite`, so a JSON file is the honest fit and it keeps the
   bundled agent free of a compiler.

   Incremental: a file whose size and mtime are unchanged is not read again.
   The cache lives in the data directory, keyed by the workspace's canonical
   path, so two projects never share one graph.
   --------------------------------------------------------------------------- */

const GRAPH_VERSION = 3
/** 5 minutes: long enough to be free, short enough that a new file shows up */
const TTL_MS = 5 * 60_000
const MAX_FILES = 6_000
const MAX_FILE_BYTES = 600_000

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'dist-agent',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'vendor',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  'Pods',
  '.gradle',
  '.loong',
])

const LANG: Record<string, string> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.cjs': 'js',
  '.css': 'css',
  '.scss': 'css',
  '.html': 'html',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.sql': 'sql',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.md': 'md',
}

const SOURCE = new Set(['ts', 'tsx', 'js', 'jsx', 'python', 'go', 'rust', 'java', 'kotlin', 'csharp', 'ruby', 'php', 'swift', 'c', 'cpp'])

export interface GraphNode {
  /** workspace-relative, forward slashes */
  path: string
  lang: string
  size: number
  mtime: number
  /** declared names, capped */
  symbols: string[]
  /** workspace-relative files this one imports */
  imports: string[]
  /** package names / unresolved specifiers */
  external: string[]
  /** entry-point signals: package.json bin/main, index, main, app, server */
  entry: boolean
}

export interface Graph {
  version: number
  root: string
  builtAt: number
  /** hash of the file list: cheap change detector for the prompt */
  digest: string
  files: GraphNode[]
}

interface CacheFile {
  version: number
  root: string
  builtAt: number
  nodes: GraphNode[]
}

function cachePath(root: string): string {
  const key = createHash('sha1').update(root).digest('hex').slice(0, 16)
  return join(DATA_DIR, `graph-${key}.json`)
}

function walk(root: string): { path: string; size: number; mtime: number }[] {
  const out: { path: string; size: number; mtime: number }[] = []
  const stack = [root]
  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop() as string
    const entries = (() => {
      try {
        return readdirSync(dir, { withFileTypes: true })
      } catch {
        return null
      }
    })()
    if (!entries) continue
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github') {
        if (e.isDirectory()) continue
      }
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        stack.push(abs)
        continue
      }
      if (!e.isFile()) continue
      const ext = extname(e.name).toLowerCase()
      if (!LANG[ext]) continue
      try {
        const s = statSync(abs)
        out.push({ path: relative(root, abs).split(sep).join('/'), size: s.size, mtime: s.mtimeMs })
      } catch {
        /* a file that vanished mid-walk is simply not in the graph */
      }
      if (out.length >= MAX_FILES) break
    }
  }
  return out
}

const JS_SYMBOLS = [
  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|\n)\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
]

const SYMBOLS: Record<string, RegExp[]> = {
  js: JS_SYMBOLS,
  ts: JS_SYMBOLS,
  tsx: JS_SYMBOLS,
  jsx: JS_SYMBOLS,
  python: [/(?:^|\n)\s*(?:async\s+)?def\s+(\w+)/g, /(?:^|\n)\s*class\s+(\w+)/g],
  go: [/(?:^|\n)func\s+(?:\([^)]*\)\s*)?(\w+)/g, /(?:^|\n)type\s+(\w+)/g],
  rust: [
    /(?:^|\n)\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g,
    /(?:^|\n)\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/g,
  ],
  java: [/(?:^|\n)\s*(?:public|private|protected)?\s*(?:static\s+)?(?:class|interface|enum)\s+(\w+)/g],
  kotlin: [/(?:^|\n)\s*(?:fun|class|object|interface)\s+(\w+)/g],
  csharp: [/(?:^|\n)\s*(?:public|private|internal)?\s*(?:static\s+)?(?:class|interface|record|struct)\s+(\w+)/g],
  ruby: [/(?:^|\n)\s*(?:def|class|module)\s+(\w+)/g],
  php: [/(?:^|\n)\s*(?:function|class)\s+(\w+)/g],
  swift: [/(?:^|\n)\s*(?:func|class|struct|enum|protocol)\s+(\w+)/g],
  c: [/(?:^|\n)[A-Za-z_][\w\s*]*\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/g],
  cpp: [/(?:^|\n)[A-Za-z_][\w\s*]*\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/g],
}

const JS_IMPORTS = [
  /(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
  /* a side-effect import still creates an edge */
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const IMPORTS: Record<string, RegExp[]> = {
  js: JS_IMPORTS,
  ts: JS_IMPORTS,
  tsx: JS_IMPORTS,
  jsx: JS_IMPORTS,
  python: [/(?:^|\n)\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/g],
  go: [/(?:^|\n)\s*(?:import\s+)?(?:[\w.]+\s+)?"([^"]+)"/g],
  rust: [/(?:^|\n)\s*use\s+([\w:]+)/g],
  java: [/(?:^|\n)\s*import\s+([\w.]+)\s*;/g],
  kotlin: [/(?:^|\n)\s*import\s+([\w.]+)/g],
  csharp: [/(?:^|\n)\s*using\s+([\w.]+)\s*;/g],
  ruby: [/(?:^|\n)\s*require(?:_relative)?\s*['"]([^'"]+)['"]/g],
  php: [/(?:^|\n)\s*(?:require|include)(?:_once)?\s*['"]([^'"]+)['"]/g],
}

const ENTRY_NAMES = new Set([
  'index.ts', 'index.tsx', 'index.js', 'index.jsx', 'main.ts', 'main.tsx', 'main.js',
  'app.tsx', 'app.ts', 'server.ts', 'server.js', 'start.ts', 'cli.ts', 'main.py',
  'main.go', 'main.rs', 'app.py', 'manage.py', '__main__.py', 'index.py',
])

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

function collect(text: string, patterns: RegExp[] | undefined, cap = 60): string[] {
  if (!patterns) return []
  const out: string[] = []
  for (const re of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const hit = (m[1] ?? m[2] ?? '').trim()
      if (hit) out.push(hit)
      if (out.length >= cap) break
      if (m.index === re.lastIndex) re.lastIndex += 1
    }
  }
  return uniq(out).slice(0, cap)
}

function resolveSpecifier(
  from: string,
  spec: string,
  known: Set<string>,
  byName?: Map<string, string>,
): string | null {
  if (!known) return null
  if (spec.startsWith('.')) {
    /* `from` is workspace-relative, so the sibling is too — resolving against
       the process cwd would put every relative import outside the graph. */
    const rel = normalize(join(dirname(from), spec)).split(sep).join('/')
    const candidates = [
      rel,
      `${rel}.ts`, `${rel}.tsx`, `${rel}.js`, `${rel}.jsx`,
      `${rel}/index.ts`, `${rel}/index.tsx`, `${rel}/index.js`, `${rel}/index.jsx`,
    ]
    for (const c of candidates) if (known.has(c)) return c
    return null
  }
  /* python: a.b → a/b.py, relative dots handled above (`.` is prefix) */
  if (spec.includes('.') && !spec.startsWith('@') && !spec.includes('/')) {
    const rel = spec.replace(/\./g, '/')
    for (const c of [`${rel}.py`, `${rel}/__init__.py`]) if (known.has(c)) return c
  }
  /* go/rust/java: try the tail as a path */
  const tail = spec.split(/[./:]/).filter(Boolean)
  for (let i = 0; i < tail.length; i++) {
    const rel = tail.slice(i).join('/')
    for (const c of [`${rel}.go`, `${rel}.rs`, `${rel}.java`, `${rel}.kt`, `${rel}.py`]) {
      if (known.has(c)) return c
    }
  }
  /* Java, Kotlin, C# and Swift import a CLASS, not a path — and a class lives
     in a file named after it. Matching the basename is what makes an Android
     project (app/src/main/java/...) produce edges at all. */
  const last = tail[tail.length - 1]
  if (last && byName) {
    for (const ext of ['java', 'kt', 'kts', 'scala', 'cs', 'swift', 'py', 'go', 'rs', 'rb', 'php']) {
      const hit = byName.get(`${last}.${ext}`.toLowerCase())
      if (hit) return hit
    }
  }
  return null
}

function parseNode(
  abs: string,
  relPath: string,
  stat: { size: number; mtime: number },
  known: Set<string>,
  byName?: Map<string, string>,
): GraphNode {
  const lang = LANG[extname(relPath).toLowerCase()] ?? 'other'
  let text = ''
  if (stat.size <= MAX_FILE_BYTES && SOURCE.has(lang)) {
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      text = ''
    }
  }
  const symbols = SOURCE.has(lang) ? collect(text, SYMBOLS[lang]) : []
  const rawImports = SOURCE.has(lang) ? collect(text, IMPORTS[lang]) : []
  const imports: string[] = []
  const external: string[] = []
  for (const spec of rawImports) {
    const hit = resolveSpecifier(relPath, spec, known, byName)
    if (hit) imports.push(hit)
    else external.push(spec)
  }
  const base = relPath.split('/').pop() ?? relPath
  return {
    path: relPath,
    lang,
    size: stat.size,
    mtime: stat.mtime,
    symbols,
    imports: uniq(imports),
    external: uniq(external).slice(0, 40),
    entry: ENTRY_NAMES.has(base) || /(?:^|\/)(?:bin|scripts?)\/[^/]+\.(?:ts|js|mjs|py|go|rs)$/.test(relPath),
  }
}

function loadCache(root: string): CacheFile | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath(root), 'utf8')) as CacheFile
    if (raw.version !== GRAPH_VERSION || raw.root !== root || !Array.isArray(raw.nodes)) return null
    return raw
  } catch {
    return null
  }
}

function saveCache(root: string, builtAt: number, nodes: GraphNode[]): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(cachePath(root), JSON.stringify({ version: GRAPH_VERSION, root, builtAt, nodes }))
  } catch {
    /* a read-only data dir must not break the graph for this run */
  }
}

let current: Graph | null = null
let building: Promise<Graph> | null = null

/** build (or refresh) the graph for the open folder */
export async function indexWorkspace(opts: { force?: boolean } = {}): Promise<Graph> {
  const root = getWorkspace()
  if (!opts.force && current && current.root === root && Date.now() - current.builtAt < TTL_MS) {
    return current
  }
  if (building) return building
  building = (async () => {
    const cached = opts.force ? null : loadCache(root)
    const previous = new Map((cached?.nodes ?? []).map((n) => [n.path, n]))
    const walked = walk(root)
    const known = new Set(walked.map((f) => f.path))
    /* basename → path, for the languages that import a class rather than a file */
    const byName = new Map<string, string>()
    for (const p of known) {
      const name = (p.split('/').pop() ?? '').toLowerCase()
      if (name && !byName.has(name)) byName.set(name, p)
    }
    const files: GraphNode[] = []
    let changed = 0
    for (const f of walked) {
      const old = previous.get(f.path)
      if (old && old.size === f.size && Math.abs(old.mtime - f.mtime) < 1) {
        files.push(old)
        continue
      }
      files.push(parseNode(join(root, ...f.path.split('/')), f.path, f, known, byName))
      changed += 1
    }
    /* a cached node whose file disappeared is not carried over */
    const digest = createHash('sha1')
      .update(files.map((f) => `${f.path}:${f.size}:${Math.round(f.mtime)}`).join('|'))
      .digest('hex')
      .slice(0, 16)
    const graph: Graph = { version: GRAPH_VERSION, root, builtAt: Date.now(), digest, files }
    current = graph
    saveCache(root, graph.builtAt, graph.files)
    if (changed > 0) graph.builtAt = Date.now()
    return graph
  })()
  try {
    return await building
  } finally {
    building = null
  }
}

/** the graph if one is already cached for this folder, without walking */
export function cachedGraph(): Graph | null {
  const root = getWorkspace()
  if (current && current.root === root) return current
  const cache = loadCache(root)
  if (!cache) return null
  current = { version: GRAPH_VERSION, root, builtAt: cache.builtAt, digest: '', files: cache.nodes }
  return current
}

export interface GraphStats {
  files: number
  sourceFiles: number
  symbols: number
  edges: number
  cycles: number
  languages: { lang: string; count: number }[]
  entries: string[]
}

export function statsOf(graph: Graph): GraphStats {
  const languages = new Map<string, number>()
  let symbols = 0
  let edges = 0
  for (const f of graph.files) {
    languages.set(f.lang, (languages.get(f.lang) ?? 0) + 1)
    symbols += f.symbols.length
    edges += f.imports.length
  }
  return {
    files: graph.files.length,
    sourceFiles: graph.files.filter((f) => SOURCE.has(f.lang)).length,
    symbols,
    edges,
    cycles: cyclesOf(graph).length,
    languages: [...languages.entries()]
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count),
    entries: graph.files.filter((f) => f.entry).map((f) => f.path).slice(0, 12),
  }
}

/** one line for the system prompt: cheap, and only if a graph exists */
export function graphLine(): string {
  const graph = cachedGraph()
  if (!graph || graph.files.length === 0) return ''
  const s = statsOf(graph)
  const langs = s.languages
    .filter((l) => SOURCE.has(l.lang))
    .slice(0, 4)
    .map((l) => `${l.lang} ${l.count}`)
    .join(', ')
  const age = Math.round((Date.now() - graph.builtAt) / 60_000)
  return `Repository graph: ${s.sourceFiles} source file(s)${langs ? ` (${langs})` : ''}, ${s.symbols} symbol(s), ${s.edges} import edge(s)${s.cycles ? `, ${s.cycles} import cycle(s)` : ''}. Built ${age}m ago — use graph_neighbors and graph_impact instead of re-reading files.`
}

export function cyclesOf(graph: Graph): string[][] {
  const byPath = new Map(graph.files.map((f) => [f.path, f]))
  const color = new Map<string, 1 | 2 | 3>()
  const stack: string[] = []
  const out: string[][] = []
  const visit = (p: string) => {
    color.set(p, 1)
    stack.push(p)
    for (const next of byPath.get(p)?.imports ?? []) {
      if (!byPath.has(next)) continue
      const c = color.get(next)
      if (c === 1) {
        const i = stack.indexOf(next)
        if (i >= 0) out.push(stack.slice(i).concat(next))
        if (out.length >= 20) return
      } else if (!c) {
        visit(next)
      }
    }
    stack.pop()
    color.set(p, 2)
  }
  for (const f of graph.files) {
    if (SOURCE.has(f.lang) && !color.has(f.path)) visit(f.path)
    if (out.length >= 20) break
  }
  return out
}

/** the map: what this project is made of, and where to start */
export function mapReport(graph: Graph): string {
  const s = statsOf(graph)
  const lines: string[] = [
    `Graph of ${displayPath(graph.root === getWorkspace() ? graph.root : graph.root)}/ — ${s.sourceFiles} source file(s), ${s.symbols} symbol(s), ${s.edges} import edge(s).`,
    `Languages: ${s.languages.slice(0, 8).map((l) => `${l.lang} ${l.count}`).join(', ') || 'none detected'}`,
  ]
  if (s.entries.length) lines.push(`Entry points: ${s.entries.join(', ')}`)
  const hot = graph.files
    .filter((f) => SOURCE.has(f.lang))
    .map((f) => ({
      path: f.path,
      score: f.imports.length * 2 + graph.files.filter((o) => o.imports.includes(f.path)).length + f.symbols.length / 4,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
  if (hot.length) {
    lines.push('', 'Most connected files (read these before guessing the architecture):')
    for (const h of hot) {
      const node = graph.files.find((f) => f.path === h.path) as GraphNode
      const dependents = graph.files.filter((o) => o.imports.includes(h.path)).length
      lines.push(`  ${h.path} — ${node.symbols.length} symbol(s), imports ${node.imports.length}, used by ${dependents}`)
    }
  }
  const cycles = cyclesOf(graph)
  if (cycles.length) {
    lines.push('', `Import cycles (${cycles.length}):`)
    for (const c of cycles.slice(0, 5)) lines.push(`  ${c.join(' → ')}`)
  }
  return lines.join('\n')
}

export function neighboursReport(graph: Graph, target: string): string {
  const node = graph.files.find((f) => f.path === target || f.path.endsWith(`/${target}`))
  if (!node) {
    const near = graph.files
      .filter((f) => f.path.includes(target.replace(/\\/g, '/')))
      .slice(0, 8)
      .map((f) => f.path)
    return near.length
      ? `No exact node for "${target}". Did you mean: ${near.join(', ')}?`
      : `No node matches "${target}" in the graph. Use graph_map to see the layout.`
  }
  const dependents = graph.files.filter((f) => f.imports.includes(node.path))
  const lines = [
    `${node.path}  (${node.lang}, ${node.symbols.length} symbol(s))`,
    node.symbols.length ? `Symbols: ${node.symbols.join(', ')}` : 'Symbols: none detected',
    node.imports.length ? `Imports (${node.imports.length}): ${node.imports.join(', ')}` : 'Imports: none',
    node.external.length ? `Packages: ${node.external.slice(0, 12).join(', ')}` : '',
    dependents.length
      ? `Imported by (${dependents.length}): ${dependents.map((f) => f.path).join(', ')}`
      : 'Imported by: nothing — changing it cannot break another file',
  ]
  return lines.filter(Boolean).join('\n')
}

/** everything that would break if this file changed */
export function impactReport(graph: Graph, target: string, depth = 3): string {
  const node = graph.files.find((f) => f.path === target || f.path.endsWith(`/${target}`))
  if (!node) return `No node matches "${target}" in the graph.`
  const reverse = new Map<string, string[]>()
  for (const f of graph.files) {
    for (const imp of f.imports) {
      const list = reverse.get(imp) ?? []
      list.push(f.path)
      reverse.set(imp, list)
    }
  }
  const seen = new Map<string, number>([[node.path, 0]])
  const queue = [node.path]
  const levels: string[][] = [[node.path]]
  for (let d = 1; d <= depth && queue.length; d++) {
    const ring: string[] = []
    const nextQueue: string[] = []
    while (queue.length) {
      const p = queue.shift() as string
      for (const up of reverse.get(p) ?? []) {
        if (!seen.has(up)) {
          seen.set(up, d)
          ring.push(up)
          nextQueue.push(up)
        }
      }
    }
    if (ring.length === 0) break
    levels.push(ring)
    queue.push(...nextQueue)
  }
  const total = [...seen.keys()].length - 1
  const lines = [
    `Impact of ${node.path}: ${total} file(s) can reach it within ${depth} import hop(s).`,
  ]
  for (let d = 1; d < levels.length; d++) {
    lines.push(`  depth ${d}: ${levels[d].join(', ')}`)
  }
  const tests = graph.files
    .filter((f) => /(?:^|\/)(?:tests?|__tests__|spec)\//.test(f.path) || /\.(?:test|spec)\.[a-z]+$/.test(f.path))
    .filter((f) => seen.has(f.path))
    .map((f) => f.path)
  lines.push(
    tests.length
      ? `Tests that can reach it: ${tests.join(', ')} — run those first.`
      : 'No test in the graph imports this file — verification must be run yourself.',
  )
  return lines.join('\n')
}

/** after a run that wrote files: refresh, so the next cycle starts from truth */
export function refreshInBackground(): void {
  const root = getWorkspace()
  if (!root) return
  void indexWorkspace({ force: true }).catch(() => {})
}

/** the canonical workspace-relative form of a user-supplied graph target */
export function normalizeTarget(target: string): string {
  try {
    return displayPath(resolveInside(target || '.'))
  } catch {
    return String(target ?? '').replace(/\\/g, '/')
  }
}
