import { sfxr } from 'jsfxr'

/* ---------------------------------------------------------------------------
   The sound engine.

   Every sound in Loong is generated from parameters at runtime. There is no
   audio file in this project and there never will be — the whole palette is a
   few hundred bytes of numbers, which also means there is no licence to track.

   Two rules hold this together:

   1. Prominence mirrors hierarchy. Tier 1 is an action you took; tier 2 is the
      world changing under you; tier 3 is texture. Nothing is louder than tier 1,
      and tier 1 is quiet.
   2. Silence is a material. Streaming tokens, hover and scrolling make no sound
      at all. If everything speaks, nothing is heard.

   The parameters are tuned for delicacy, which for a chiptune generator means:
   sine rather than square, a very short envelope, a high base frequency, and an
   aggressive high-pass so no body survives. What is left is a tick, not a note.
   --------------------------------------------------------------------------- */

const P = (
  wave_type: number,
  p_base_freq: number,
  p_env_sustain: number,
  p_env_decay: number,
  p_hpf_freq: number,
  sound_vol: number,
  extra: Record<string, number> = {},
) => ({
  oldParams: true,
  wave_type,
  p_env_attack: 0,
  p_env_sustain,
  p_env_punch: 0,
  p_env_decay,
  p_base_freq,
  p_freq_limit: 0,
  p_freq_ramp: 0,
  p_freq_dramp: 0,
  p_vib_strength: 0,
  p_vib_speed: 0,
  p_arp_mod: 0,
  p_arp_speed: 0,
  p_duty: 0.5,
  p_duty_ramp: 0,
  p_repeat_speed: 0,
  p_pha_offset: 0,
  p_pha_ramp: 0,
  p_lpf_freq: 1,
  p_lpf_ramp: 0,
  p_lpf_resonance: 0,
  p_hpf_freq,
  p_hpf_ramp: 0,
  sound_vol,
  sample_rate: 44100,
  sample_size: 16,
  ...extra,
})

export type SoundName =
  | 'click'
  | 'select'
  | 'send'
  | 'toolStart'
  | 'toolDone'
  | 'approve'
  | 'error'
  | 'done'

/** wave 2 = sine, wave 0 = square, wave 3 = noise */
export const SOUND_DEFS: Record<SoundName, Record<string, unknown>> = {
  /* tier 3 — texture. felt more than heard. */
  click: P(2, 0.8, 0.012, 0.042, 0.74, 0.16, { p_freq_ramp: -0.14 }),
  select: P(2, 0.66, 0.018, 0.062, 0.68, 0.18, { p_freq_ramp: 0.08 }),

  /* tier 1 — things you did. the loudest sounds in the app, and still quiet.
     `send` was a rising two-note blip and it was genuinely irritating by the
     fiftieth message. It is now a single short tick: higher, quieter, heavily
     high-passed, and with the pitch rise cut from +0.26 to +0.12 so it reads as
     a latch closing rather than a notification. */
  send: P(2, 0.64, 0.01, 0.075, 0.76, 0.17, { p_freq_ramp: 0.12 }),
  approve: P(2, 0.58, 0.025, 0.13, 0.6, 0.26, { p_freq_ramp: 0.14 }),

  /* tier 2 — the world changing. */
  toolStart: P(0, 0.74, 0.008, 0.048, 0.78, 0.2, { p_freq_ramp: -0.1 }),
  toolDone: P(2, 0.62, 0.02, 0.14, 0.58, 0.26, { p_freq_ramp: -0.12 }),
  /* `error` used to be the loudest sound in the app: a low square wave with a
     long decay and almost no high-pass, which is a buzzer. It is now the
     quietest thing above the texture tier — a short, high-passed, falling sine
     that reads as a marker rather than a reprimand. The card in the thread is
     the real signal; the sound only says "look". */
  error: P(2, 0.5, 0.01, 0.088, 0.68, 0.22, { p_freq_ramp: -0.18 }),
  done: P(2, 0.68, 0.04, 0.3, 0.5, 0.28, {
    p_arp_mod: -0.32,
    p_arp_speed: 0.62,
  }),
}

/** prominence per sound — the tier, expressed as a gain multiplier */
const TIER: Record<SoundName, number> = {
  send: 1,
  approve: 0.95,
  done: 1,
  error: 0.5,
  toolStart: 0.68,
  toolDone: 0.68,
  click: 0.4,
  select: 0.4,
}

const THROTTLE_MS = 55

class SoundEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private buffers = new Map<SoundName, AudioBuffer>()
  private last = new Map<SoundName, number>()

  enabled = false
  volume = 0.7

  private ensure(): boolean {
    if (typeof window === 'undefined') return false
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) return false
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)
    }
    return true
  }

  /** must be called from inside a user gesture, once */
  unlock() {
    if (!this.ensure()) return
    if (this.ctx!.state === 'suspended') void this.ctx!.resume()
    for (const name of Object.keys(SOUND_DEFS) as SoundName[]) this.buffer(name)
  }

  private buffer(name: SoundName): AudioBuffer | null {
    const cached = this.buffers.get(name)
    if (cached) return cached
    if (!this.ensure()) return null
    const src = sfxr.toWebAudio(
      SOUND_DEFS[name] as never,
      this.ctx as never,
    ) as AudioBufferSourceNode | undefined
    if (!src) return null
    this.buffers.set(name, src.buffer as AudioBuffer)
    return src.buffer as AudioBuffer
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (on) this.unlock()
  }

  setVolume(v: number) {
    this.volume = v
    if (this.master) this.master.gain.value = v
  }

  play(name: SoundName) {
    if (!this.enabled) return
    if (!this.ensure()) return

    const now = performance.now()
    const prev = this.last.get(name) ?? -1e9
    if (now - prev < THROTTLE_MS) return
    this.last.set(name, now)

    const buf = this.buffer(name)
    if (!buf || !this.ctx || !this.master) return
    if (this.ctx.state === 'suspended') void this.ctx.resume()

    const node = this.ctx.createBufferSource()
    node.buffer = buf
    const gain = this.ctx.createGain()
    gain.gain.value = TIER[name]
    node.connect(gain).connect(this.master)
    node.start()
  }
}

export const sound = new SoundEngine()
export const TIER_OF = TIER
