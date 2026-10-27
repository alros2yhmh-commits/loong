import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateText } from 'ai'
import {
  cachedModelLimits,
  callProviderOptions,
  fallbackModelsFor,
  listLocalModels,
  listOpenRouterModels,
  resolveModel,
  openRouterCatalogStatus,
} from '../server/providers.ts'
import { loadCatalog, modelsOf, catalogStatus } from '../server/catalog.ts'
import { spawnSync } from 'node:child_process'
import { DATA_DIR } from '../server/config.ts'
import { loadModelCatalog } from '../src/lib/model-catalog.ts'

const data = [
  { id: 'example/free-a:free', name: 'Free A', context_length: 65536, supported_parameters: ['tools', 'parallel_tool_calls', 'reasoning'], top_provider: { max_completion_tokens: 4096 }, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'] } },
  { id: 'example/free-vision:free', context_length: 32768, supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'] } },
  { id: 'example/output-paid', context_length: 131072, supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0.000004' } },
  { id: 'example/unknown-price', supported_parameters: ['tools'] },
  { id: 'example/zero-cost', supported_parameters: ['tools'], pricing: { prompt: '0.0', completion: '0.000' } },
  { id: 'example/chat-only:free', supported_parameters: [] },
  { id: 'example/model:batch', supported_parameters: ['tools'] },
]

async function withFetch<T>(fetcher: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = fetcher
  try { return await run() } finally { globalThis.fetch = original }
}

test('OpenRouter catalog preserves real limits and never labels zero-input paid output as free', async () => {
  await withFetch(async () => Response.json({ data }), async () => {
    const models = await listOpenRouterModels(true)
    assert.equal(models.some((m) => /chat-only|batch/.test(m.id)), false)
    assert.equal(models.find((m) => m.id === 'example/output-paid')?.free, false)
    assert.equal(models.find((m) => m.id === 'example/unknown-price')?.free, false)
    assert.equal(models.find((m) => m.id === 'example/zero-cost')?.free, true)
    assert.deepEqual(cachedModelLimits('openrouter', 'example/free-a:free'), {
      contextWindowTokens: 65536,
      maxOutputTokens: 4096,
    })
    assert.deepEqual(cachedModelLimits('openrouter', 'unknown'), {})
  })
})

test('Fixed routing never changes models; Auto fallbacks stay free and capability-compatible', () => {
  const config = { provider: 'openrouter' as const, model: 'example/free-a:free' }
  assert.deepEqual(fallbackModelsFor(config, { route: 'manual' }), [])
  assert.deepEqual(fallbackModelsFor(config), [])
  assert.deepEqual(fallbackModelsFor(config, { route: 'auto', vision: true }), ['example/free-vision:free'])
  const auto = fallbackModelsFor(config, { route: 'auto' })
  assert.ok(auto.includes('example/zero-cost'))
  assert.ok(!auto.includes(config.model))
  assert.ok(!auto.includes('example/output-paid'))
  assert.deepEqual(fallbackModelsFor({ ...config, model: 'example/output-paid' }, { route: 'auto' }), [])
})

test('OpenRouter request requires supported parameters and keeps one explicit model', async () => {
  let sent: Record<string, unknown> | null = null
  const config = { provider: 'openrouter' as const, model: 'example/free-a:free', apiKey: 'test-placeholder' }
  await withFetch(async (_url, init) => {
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json({
      id: 'test-response', model: config.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    })
  }, async () => {
    const response = await generateText({ model: resolveModel(config), prompt: 'hello', maxOutputTokens: 32, maxRetries: 0, providerOptions: callProviderOptions(config) as never })
    assert.equal(response.text, 'ok')
  })
  const body = sent as unknown as Record<string, unknown>
  assert.equal(body.model, config.model)
  assert.equal(body.models, undefined, 'model fallback is owned by the run controller')
  assert.deepEqual(body.provider, { require_parameters: true, allow_fallbacks: true, max_price: { prompt: 0, completion: 0 } })
  assert.equal(body.parallel_tool_calls, true)
  assert.equal(body.cacheControl, undefined, 'unsupported top-level cache options must not leak into requests')
})

test('OpenRouter cache remains available with an explicit stale marker when refresh fails', async () => {
  const models = await withFetch(async () => { throw new Error('offline') }, () => listOpenRouterModels(true))
  assert.ok(models.length > 0)
  assert.ok(models.every((m) => m.stale === true))
})

test('local tool capability comes from metadata rather than a coder name heuristic', async () => {
  await withFetch(async () => Response.json({ models: [
    { name: 'best-coder', capabilities: ['completion', 'tools'] },
    { name: 'chat-only', capabilities: ['completion'] },
    { name: 'unknown-coder' },
  ] }), async () => {
    const models = await listLocalModels()
    assert.deepEqual(models.map((m) => m.supportsTools), [true, false, null])
  })
})

test('picker dispatches catalogs by provider and normalizes hosted context metadata', async () => {
  const urls: string[] = []
  await withFetch(async (url) => {
    urls.push(String(url))
    return Response.json({ models: [{ id: 'hosted', contextLength: 65536 }] })
  }, async () => {
    assert.equal((await loadModelCatalog('openrouter')).models[0].context, 65536)
    await loadModelCatalog('anthropic')
    await loadModelCatalog('google')
    await loadModelCatalog('openai')
    await loadModelCatalog('ollama')
    assert.deepEqual(await loadModelCatalog('custom'), { models: [], stale: false })
  })
  assert.ok(urls[0].endsWith('/api/openrouter/models'))
  for (const [index, provider] of ['anthropic', 'google', 'openai'].entries()) {
    assert.ok(urls[index + 1].endsWith(`/api/catalog/models?provider=${provider}`))
  }
  assert.ok(urls[4].endsWith('/api/models'))
})

test('catalog memory expires, refreshes, and preserves offline cache age', async () => {
  const initial = { anthropic: { models: { example: { id: 'example', tool_call: true, attachment: true, reasoning: true, limit: { context: 100000, output: 6000 }, cost: { input: 3, output: 15 } } } } }
  let requests = 0
  const now = Date.now
  await withFetch(async () => { requests += 1; return Response.json(initial) }, async () => {
    const catalog = await loadCatalog(true)
    const model = modelsOf(catalog, 'anthropic')[0]
    assert.equal(model.context, 100000)
    assert.equal(model.output, 6000)
    assert.equal(model.tools, true)
    assert.equal(model.vision, true)
    assert.equal(model.reasoning, true)
    await loadCatalog()
    assert.equal(requests, 1, 'fresh memory should avoid a second fetch')
    try {
      Date.now = () => now() + 25 * 60 * 60 * 1000
      await loadCatalog()
      assert.equal(requests, 2, 'expired memory must refresh')
    } finally { Date.now = now }
  })
  const fetched = catalogStatus().fetchedAt
  await withFetch(async () => { throw new Error('offline') }, async () => {
    assert.equal(modelsOf(await loadCatalog(true), 'anthropic')[0].id, 'example')
    assert.equal(catalogStatus().fetchedAt, fetched, 'offline use must not reset freshness')
  })
})


test('public OpenRouter metadata is restored in a new process without a network call', () => {
  const probe = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    globalThis.fetch = async () => { throw new Error('Unexpected network call') }
    const { cachedModelLimits, openRouterCatalogStatus } = await import('./server/providers.ts')
    console.log(JSON.stringify({ limits: cachedModelLimits('openrouter', 'example/free-a:free'), cache: openRouterCatalogStatus() }))
  `], { cwd: process.cwd(), env: { ...process.env, LOONG_DATA_DIR: DATA_DIR }, encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  const output = JSON.parse(probe.stdout.trim())
  assert.equal(output.limits.contextWindowTokens, 65536)
  assert.equal(output.limits.maxOutputTokens, 4096)
  assert.equal(typeof output.cache.fetchedAt, 'number')
  assert.equal(openRouterCatalogStatus().stale, false)
})

test('paid model requests do not inherit a free-only price guard', () => {
  const options = callProviderOptions({ provider: 'openrouter', model: 'example/output-paid' }) as {
    openrouter: { provider: { max_price?: unknown } }
  }
  assert.equal(options.openrouter.provider.max_price, undefined)
})

test('malformed remote metadata does not crash or duplicate the model picker', async () => {
  await withFetch(async () => Response.json({ data: [
    { id: 'valid:free', supported_parameters: ['tools'], architecture: { input_modalities: null } },
    { id: 'valid:free', supported_parameters: ['tools'] },
    { id: 'string-tools', supported_parameters: 'tools' },
    { id: 'wrong-window:free', context_length: -1, supported_parameters: ['tools'], top_provider: { max_completion_tokens: -4 } },
    null,
  ] }), async () => {
    const models = await listOpenRouterModels(true)
    assert.equal(models.filter((model) => model.id === 'valid:free').length, 1)
    assert.equal(models.some((model) => model.id === 'string-tools'), false)
    assert.equal(models.find((model) => model.id === 'valid:free')?.vision, false)
    assert.deepEqual(cachedModelLimits('openrouter', 'wrong-window:free'), {})
  })
})
