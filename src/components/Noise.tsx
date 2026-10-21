/* ---------------------------------------------------------------------------
   Device 2 — micro-noise.

   One fractal turbulence filter, rendered once, covering the whole window.
   It is deliberately a single fixed layer rather than a background on each
   surface: a per-element grain would be re-rasterised on every scroll frame
   and would cost more than every animation in the app combined.
   --------------------------------------------------------------------------- */

export function Noise() {
  return (
    <svg className="noise-layer" width="100%" height="100%" aria-hidden="true">
      <filter id="loong-grain">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.82"
          numOctaves="3"
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#loong-grain)" />
    </svg>
  )
}
