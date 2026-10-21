import { generateObject } from 'ai'
import { z } from 'zod'
import { resolveModel, type ProviderConfig } from './providers.ts'

/* ---------------------------------------------------------------------------
   Confidence for an autonomous write.

   TypeSafe's Jev made the idea legible: a decision should carry a confidence,
   and code should set the threshold for when it acts on its own and when it
   asks a human. Loong borrows the SHAPE, honestly: this asks a model to score
   0..1 how safe it is to apply one specific change automatically, and the run
   parks the change for review below the gate.

   It is the model's own estimate, not a Jev-calibrated probability — the point
   is the gate and the transparency, not a claim of calibration. Point the
   decision model at a cheap typed model (TypeSafe's jev-router on OpenRouter)
   to make the check fast and nearly free.

   Failures fail CLOSED: any error, timeout or missing model returns null and
   the caller treats that as "ask a human", never "apply".
   --------------------------------------------------------------------------- */

const Schema = z.object({
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      '0..1 probability that applying this change automatically, without a human reviewing it, is safe and correct',
    ),
  rationale: z.string().describe('one short sentence explaining the score'),
})

export interface ConfidenceInput {
  tool: string
  title: string
  detail: string
}

export interface ConfidenceEstimate {
  confidence: number
  rationale: string
}

/** null means "could not estimate" — the caller must treat that as not-safe. */
export async function estimateConfidence(
  runConfig: ProviderConfig,
  decisionModel: string | undefined,
  input: ConfidenceInput,
): Promise<ConfidenceEstimate | null> {
  try {
    const model = resolveModel({
      ...runConfig,
      model: decisionModel?.trim() || runConfig.model,
    })
    /* keep the check cheap: the diff is capped, the answer is a few tokens */
    const detail =
      input.detail.length > 3000 ? `${input.detail.slice(0, 3000)}\n… (trimmed)` : input.detail
    const { object } = await generateObject({
      model,
      schema: Schema,
      maxOutputTokens: 220,
      abortSignal: AbortSignal.timeout(20_000),
      messages: [
        {
          role: 'system',
          content:
            'You score how safe it is to apply one automated change with no human reviewing it. Be conservative: anything ambiguous, destructive or irreversible, dependent on context you cannot see, or a diff you cannot fully verify scores LOW (below 0.5). Routine, clearly described, reversible edits with a legible diff score HIGH. Answer with a probability 0..1 and one short reason. This is your honest estimate, not a measured rate.',
        },
        {
          role: 'user',
          content: `Tool: ${input.tool}\nAction: ${input.title}\n---\n${detail}`,
        },
      ],
    })
    const c = object.confidence
    if (typeof c !== 'number' || !Number.isFinite(c)) return null
    return {
      confidence: Math.min(1, Math.max(0, c)),
      rationale: (object.rationale ?? '').slice(0, 200),
    }
  } catch {
    /* a failed estimation is never permission to act */
    return null
  }
}

/* exported for tests: the pure decision the run makes around an estimate */
export function gateDecision(
  estimate: ConfidenceEstimate | null,
  threshold: number,
): 'auto' | 'ask' {
  if (estimate == null) return 'ask'
  return estimate.confidence >= threshold ? 'auto' : 'ask'
}
