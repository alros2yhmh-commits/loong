import { readFileSync, writeFileSync, existsSync } from 'node:fs'

/* ---------------------------------------------------------------------------
   Build a real .ico.

   electron-builder's own PNG→ICO conversion produced a blank white tile, so the
   EXE kept the default Electron icon. The ICO container is simple enough to
   write directly: a 6-byte header, a 16-byte directory entry per image, then the
   PNG bytes. Windows reads PNG-compressed entries from Vista onward.
   --------------------------------------------------------------------------- */

const sizes = [256, 128, 64, 48, 32, 16]
const images = []
for (const s of sizes) {
  const p = `public/icon/icon-${s}.png`
  if (!existsSync(p)) throw new Error(`missing ${p}`)
  images.push({ size: s, data: readFileSync(p) })
}

const count = images.length
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(count, 4)

const dir = Buffer.alloc(16 * count)
let offset = 6 + 16 * count

images.forEach((img, i) => {
  const b = i * 16
  /* 256 is written as 0 in the directory */
  dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0)
  dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1)
  dir.writeUInt8(0, b + 2) // palette
  dir.writeUInt8(0, b + 3) // reserved
  dir.writeUInt16LE(1, b + 4) // colour planes
  dir.writeUInt16LE(32, b + 6) // bits per pixel
  dir.writeUInt32LE(img.data.length, b + 8)
  dir.writeUInt32LE(offset, b + 12)
  offset += img.data.length
})

const ico = Buffer.concat([header, dir, ...images.map((i) => i.data)])
writeFileSync('build/icon.ico', ico)

/* prove it is not blank: the smallest entry must contain the star's dark ink */
const { PNG } = await import('pngjs')
const png = PNG.sync.read(images.find((i) => i.size === 256).data)
let dark = 0
for (let i = 0; i < png.data.length; i += 4) {
  if (png.data[i] < 60 && png.data[i + 1] < 60 && png.data[i + 2] < 60) dark++
}
console.log(`build/icon.ico written: ${ico.length} bytes, ${count} sizes`)
console.log(`dark pixels in the 256px entry: ${dark} (${((dark / (256 * 256)) * 100).toFixed(1)}%)`)
if (dark < 500) console.log('SUSPECT: the mark is barely there')
