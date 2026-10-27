import { api, type ModelInfo } from './api'

export interface ModelCatalogResult {
  models: ModelInfo[]
  error?: string
  stale?: boolean
}

/** Hosted providers must never use Ollama's local /api/models endpoint. */
export async function loadModelCatalog(provider: string): Promise<ModelCatalogResult> {
  const result: ModelCatalogResult = provider === 'ollama'
    ? await api.models()
    : provider === 'openrouter'
      ? await api.openrouterModels()
      : ['anthropic', 'openai', 'google'].includes(provider)
        ? await api.catalog(provider)
        : { models: [] }
  const models = Array.isArray(result.models) ? result.models : []
  return {
    ...result,
    stale: result.stale === true || models.some((model) => (model as ModelInfo & { stale?: boolean }).stale === true),
    models: models.map((model) => ({
      ...model,
      id: model.id || model.name || '',
      context: model.context ?? model.contextLength ?? null,
    })).filter((model) => model.id),
  }
}
