/* probe: is typesafe/jev-1.13 on OpenRouter, and is it chat-callable? */
const res = await fetch('https://openrouter.ai/api/v1/models')
if (!res.ok) {
  console.log('MODELS_LIST_FAILED', res.status)
  process.exit(0)
}
const body = await res.json()
const all = Array.isArray(body.data) ? body.data : []
const hits = all.filter((m) => /jev|typesafe/i.test(m.id ?? ''))
console.log('TOTAL_MODELS', all.length)
if (hits.length === 0) {
  console.log('JEV_NOT_LISTED')
} else {
  for (const m of hits) {
    console.log('---')
    console.log('id', m.id)
    console.log('name', m.name)
    console.log('pricing', JSON.stringify(m.pricing))
    console.log('context', m.context_length)
    console.log('supported_parameters', JSON.stringify(m.supported_parameters ?? []))
    console.log('architecture', JSON.stringify(m.architecture ?? {}))
  }
}
