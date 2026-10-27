/* ---------------------------------------------------------------------------
   Build the agent sidecar.

   Same bundle as `esbuild server/start.ts --bundle …` with one addition: a
   resolve plugin. playwright-core carries a WebDriver-BiDi transport whose
   `require` sits at the top of its 40k-line bundle; Loong launches the
   machine's own Chromium over CDP and never touches that code, but a bundler
   must resolve every static require or fail — and the transport's package is
   not one we depend on.

   The plugin sends any `chromium-bidi/…` require to the stub next door, so
   the bundle resolves, and if a BiDi path is ever taken it fails with a clear
   sentence instead of a module-not-found from inside the bundle.
   --------------------------------------------------------------------------- */

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const bidiStub = {
  name: 'chromium-bidi-stub',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^chromium-bidi(\/|$)/ }, () => ({
      path: join(root, 'server', 'stubs', 'chromium-bidi.ts'),
    }))
  },
}

/* Cline's runtime links Langfuse and the OpenTelemetry node SDK, and the
   versions in the tree disagree about the API — bundling them fails on an
   export that does not exist. Loong never enables vendor telemetry, so the
   whole family resolves to one stub that throws if it is ever constructed. */
const telemetryStub = {
  name: 'telemetry-stub',
  setup(pluginBuild) {
    pluginBuild.onResolve(
      { filter: /^@langfuse(\/|$)|^@opentelemetry\/(sdk-trace-node|sdk-trace-base|context-async-hooks|core|exporter-|otlp-)/ },
      () => ({ path: join(root, 'server', 'stubs', 'telemetry.ts') }),
    )
  },
}

await build({
  entryPoints: [join(root, 'server', 'start.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: join(root, 'dist-agent', 'loong-agent.cjs'),
  external: ['node-pty', 'better-sqlite3', 'node:*'],
  plugins: [bidiStub, telemetryStub],
  logLevel: 'info',
})

console.log('[loong] agent bundle written to dist-agent/loong-agent.cjs')

/* playwright-core locates two files with paths it builds at runtime
   (`join(packageRoot, 'browsers.json')` and `…'package.json'`, where
   packageRoot = __dirname/..). No bundler can resolve a computed path, so
   both files are written next to the bundle: electron-builder then places one
   copy in resources/agent/ (it ships dist-agent whole) and one in resources/
   via extraResources — the two spots the runtime path can land. */
const pwBrowsers = join(root, 'node_modules', 'playwright-core', 'browsers.json')
if (existsSync(pwBrowsers)) {
  copyFileSync(pwBrowsers, join(root, 'dist-agent', 'browsers.json'))
  console.log('[loong] playwright browser registry copied to dist-agent/')
} else {
  console.warn('[loong] playwright browsers.json not found — the browser tool will report it')
}
writeFileSync(
  join(root, 'dist-agent', 'package.json'),
  JSON.stringify({ name: 'playwright-core', version: '1.0.0-loong', private: true }, null, 2),
  'utf8',
)
console.log('[loong] playwright identity file copied to dist-agent/')

/* The agent's own identity travels beside the bundle: the sidecar cannot read
   the app's package.json once electron-builder has packed resources, and the
   package.json it does find there is playwright's. */
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
writeFileSync(
  join(root, 'dist-agent', 'identity.json'),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
    },
    null,
    2,
  ),
  'utf8',
)
console.log('[loong] identity manifest written to dist-agent/identity.json')

/* The agent bundle is Loong's own code: no vendored runtime, so there is no
   third-party loop to attribute and no license file to carry beside it. */

/* node-pty is external in the bundle (a native module cannot be bundled), so
   its runtime has to travel next to it. Only what it actually loads is copied:
   package.json, lib/, and the prebuild for this platform — not the 60 MB of
   sources, other platforms' binaries, or the .pdb debug symbols. */
const ptySrc = join(root, 'node_modules', 'node-pty')

/* a .node file can be held open by a running app or a scanner for a moment;
   a build that dies on that is a build that fails for no reason */
async function copyTree(from, to, options = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      cpSync(from, to, { recursive: true, force: true, ...options })
      return
    } catch (err) {
      if (attempt === 4) throw err
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }
}

if (existsSync(ptySrc)) {
  const ptyDest = join(root, 'dist-agent', 'node_modules', 'node-pty')
  try {
    rmSync(ptyDest, { recursive: true, force: true })
  } catch {
    /* a locked file is overwritten by the copy below */
  }
  mkdirSync(join(ptyDest, 'prebuilds'), { recursive: true })
  copyFileSync(join(ptySrc, 'package.json'), join(ptyDest, 'package.json'))
  await copyTree(join(ptySrc, 'lib'), join(ptyDest, 'lib'))
  const platformDir = `${process.platform}-${process.arch}`
  const prebuild = join(ptySrc, 'prebuilds', platformDir)
  if (existsSync(prebuild)) {
    await copyTree(prebuild, join(ptyDest, 'prebuilds', platformDir), {
      filter: (src) => !src.endsWith('.pdb'),
    })
    console.log(`[loong] node-pty runtime copied (${platformDir})`)
  } else {
    console.warn(`[loong] node-pty has no prebuild for ${platformDir}`)
  }
} else {
  console.warn('[loong] node-pty not installed — the terminal tool will report it')
}
