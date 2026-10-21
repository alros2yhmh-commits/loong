/* jsfxr ships no types. The surface we actually use is four functions, so the
   declaration is written here rather than pulled from a community package —
   less to trust, and it fails loudly if the real API shifts. */
declare module 'jsfxr' {
  export type SynthDef = Record<string, number | boolean>

  export const sfxr: {
    generate: (preset: string) => SynthDef
    toBuffer: (def: SynthDef) => { normalized: Float32Array }
    toWebAudio: (
      def: SynthDef,
      ctx: AudioContext,
    ) => AudioBufferSourceNode | undefined
    toWave: (def: SynthDef) => { dataURI: string }
    toAudio: (def: SynthDef) => HTMLAudioElement
    play: (def: SynthDef) => void
    b58encode: (def: SynthDef) => string
    b58decode: (s: string) => SynthDef
  }
}
