import type { BaseEvent } from '@ag-ui/core'

/** Loong's transport is JSON SSE; it does not load a protobuf parser in the agent. */
export class EventEncoder {
  constructor(_options: { accept: string } = { accept: 'text/event-stream' }) {}
  encodeSSE(event: BaseEvent): string {
    // JSON escaping keeps embedded newlines from becoming SSE control frames.
    return `data: ${JSON.stringify(event)}\n\n`
  }
}
