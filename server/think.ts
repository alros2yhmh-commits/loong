/* A model that leaks its closing thinking tag into prose shows the reader a
   literal `</think>` in the answer. The tag is framing, not content: strip it,
   including when a provider splits it across two stream deltas. */

const TAG = /<\/?think(?:ing)?>/gi
/* the longest tail of a delta that could still become a tag */
const PARTIAL = /<\/?t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?$/i

export class ThinkFilter {
  private carry = ''

  push(delta: string): string {
    let text = this.carry + delta
    this.carry = ''
    const held = PARTIAL.exec(text)
    if (held && held[0].length > 0) {
      this.carry = held[0]
      text = text.slice(0, -held[0].length)
    }
    return text.replace(TAG, '')
  }

  flush(): string {
    const rest = this.carry.replace(TAG, '')
    this.carry = ''
    return rest
  }
}
