import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync } from 'node:fs'

/* ---------------------------------------------------------------------------
   Two screenshots, one number.

   "Change the CSS and look at it" is not a check a model can perform by
   reading text — it will describe what it intended, not what rendered. A pixel
   diff is the honest version: same viewport, same page, and the count of pixels
   that actually moved.

   Threshold is 0.1: below that, anti-aliasing and sub-pixel text rendering
   produce noise that is not a change anyone made.
   --------------------------------------------------------------------------- */

export interface ScreenDiff {
  changed: number
  total: number
  percent: number
  width: number
  height: number
  diffPath: string
}

export function compareScreens(
  beforePath: string,
  afterPath: string,
  diffPath: string,
): ScreenDiff {
  const before = PNG.sync.read(readFileSync(beforePath))
  const after = PNG.sync.read(readFileSync(afterPath))

  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `The screenshots differ in size: ${before.width}×${before.height} vs ${after.width}×${after.height}. ` +
        'Capture both at the same viewport so the diff means something.',
    )
  }

  const diff = new PNG({ width: before.width, height: before.height })
  const changed = pixelmatch(
    before.data,
    after.data,
    diff.data,
    before.width,
    before.height,
    { threshold: 0.1 },
  )

  writeFileSync(diffPath, PNG.sync.write(diff))

  const total = before.width * before.height
  return {
    changed,
    total,
    percent: total > 0 ? (changed / total) * 100 : 0,
    width: before.width,
    height: before.height,
    diffPath,
  }
}
