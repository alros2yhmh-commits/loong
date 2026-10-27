import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const directory = path.resolve(process.argv[2] || 'app')
const artifacts = (await readdir(directory)).filter((name) => /\.(exe|AppImage|zip|dmg|deb|rpm)$/.test(name)).sort()
if (!artifacts.length) throw new Error(`No release artifacts found in ${directory}`)
const lines = []
for (const name of artifacts) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk)
  lines.push(`${hash.digest('hex')}  ${name}`)
}
await writeFile(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n')
console.log(`Wrote checksums for ${artifacts.length} artifact(s)`)
