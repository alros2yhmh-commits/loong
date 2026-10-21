/* The Loong film score — synthesized, license-free.
   A slow minor pad (sine + harmonics, detuned, tremolo) with a touch of
   air, and hairline ticks on the beats. Written straight to 16-bit PCM. */
const fs = require('fs')
const SR = 44100
const DUR = 184
const N = SR * DUR
const L = new Float32Array(N)
const R = new Float32Array(N)

/* --- the pad: Am - F - C - G, one chord every 16s, crossfaded --- */
const A = 110.0
const chords = [
  [A, A * 1.2, A * 1.5, A * 2],           /* Am */
  [A * 0.8909, A * 1.118, A * 1.335, A * 1.7818], /* F */
  [A, A * 1.25, A * 1.5, A * 1.875],      /* C */
  [A * 0.8909, A * 1.1225, A * 1.5, A * 1.7818], /* G */
]
const CHORD = 16
for (let ci = 0; ci < chords.length; ci++) {
  const ch = chords[ci % chords.length]
  const start = ci * CHORD
  for (let i = 0; i < CHORD * SR && start * SR + i < N; i++) {
    const idx = start * SR + i
    const t = i / SR
    /* one slow breath per chord */
    const env = Math.min(1, t / 3.5) * Math.min(1, (CHORD - t) / 4) * (0.5 + 0.5 * Math.sin(t * 0.55 + ci))
    let s = 0
    ch.forEach((f, vi) => {
      const det = 1 + (vi % 2 ? 0.0016 : -0.0016)
      s += Math.sin(2 * Math.PI * f * det * t) * (vi === 0 ? 0.5 : 0.26)
      s += Math.sin(2 * Math.PI * f * 2 * t) * 0.09
      s += Math.sin(2 * Math.PI * f * 3 * t) * 0.035
    })
    s *= 0.115 * env
    /* slow stereo drift */
    L[idx] += s * (0.9 + 0.1 * Math.sin(t * 0.21 + ci))
    R[idx] += s * (0.9 + 0.1 * Math.cos(t * 0.17 + ci * 1.3))
  }
}

/* --- air: filtered noise, very low --- */
let seed = 7
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5 }
let lp = 0
for (let i = 0; i < N; i++) {
  const n = rnd() * 0.012
  lp += (n - lp) * 0.02
  L[i] += lp; R[i] += lp * 0.8
}

/* --- the ticks: hairline clicks on the beats --- */
const TICKS = [0.6, 2.6, 4.8, 7.0, 10.6, 16.8, 28.8, 39.0, 60.6, 69.6, 105.0, 117.0, 129.0, 141.4, 150.4]
function tick(t0, gain = 1) {
  const s0 = Math.floor(t0 * SR)
  const len = Math.floor(0.05 * SR)
  for (let i = 0; i < len && s0 + i < N; i++) {
    const t = i / SR
    const env = Math.exp(-t * 90)
    const v = (Math.sin(2 * Math.PI * 2100 * t) * 0.6 + Math.sin(2 * Math.PI * 3100 * t) * 0.4) * env * 0.16 * gain
    L[s0 + i] += v; R[s0 + i] += v * 0.9
  }
}
TICKS.forEach((t) => tick(t))
/* the reveal gets a softer, deeper tick — a moment, not a click */
tick(69.9, 1.6)

/* --- master: fade in/out, gentle limit --- */
function writeWav(path) {
  const data = Buffer.alloc(N * 4)
  for (let i = 0; i < N; i++) {
    const master = Math.min(1, Math.max(-1, (L[i] + R[i]) * 0.5))
    const fadeIn = Math.min(1, i / (SR * 2))
    const fadeOut = Math.min(1, (N - i) / (SR * 3))
    const m = master * fadeIn * fadeOut * 0.9
    data.writeIntLE(Math.floor(m * 0.85 * 32767), i * 4, 2)
    data.writeIntLE(Math.floor(m * 0.85 * 32767), i * 4 + 2, 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + N * 4, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20)
  header.writeUInt16LE(2, 22); header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28)
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(N * 4, 40)
  fs.writeFileSync(path, Buffer.concat([header, data]))
  console.log('score written:', path)
}
writeWav('C:/Users/Hamza/Desktop/film/score.wav')
