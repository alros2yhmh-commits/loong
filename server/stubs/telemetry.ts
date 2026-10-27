/* ---------------------------------------------------------------------------
   Vendor telemetry, stubbed.

   A dependency in this tree can pull in Langfuse and OpenTelemetry exporters
   when a key is configured. Loong never configures one — the agent talks to the
   provider the reader chose and nothing else leaves the machine. Those
   exporters also disagree about the OpenTelemetry API across versions, so they
   cannot be bundled (the build fails on a missing SeverityNumber export) and
   must not be shipped half-working.

   They resolve here instead: dead weight that costs nothing, and a path that
   throws a plain sentence if anything ever tries to start a third-party export.
   --------------------------------------------------------------------------- */

function unavailable(name: string): never {
  throw new Error(`${name} is not part of Loong: a run is never exported to a third-party service.`)
}

export class LangfuseVercelAiSdkIntegration {
  constructor() {
    unavailable('Langfuse telemetry')
  }
}

export class LangfuseSpanProcessor {
  constructor() {
    unavailable('Langfuse telemetry')
  }
}

export class NodeTracerProvider {
  constructor() {
    unavailable('OpenTelemetry tracing')
  }
}

/** carried between spans; with no exporter there is no span */
export function getPropagatedAttributesFromContext(): Record<string, unknown> {
  return {}
}
