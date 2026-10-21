/* A minimal MCP server over stdio — newline-delimited JSON-RPC.
   It exists so the client can be tested without spawning a real product. */

process.stdin.setEncoding('utf8')
let buffer = ''

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(message) {
  const id = message.id
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-mcp', version: '1.0.0' },
      },
    })
    return
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echo the text back.',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
          {
            name: 'add',
            description: 'Add two numbers.',
            inputSchema: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
            },
          },
        ],
      },
    })
    return
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    if (name === 'echo') {
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `echo: ${args.text ?? ''}` }] },
      })
      return
    }
    if (name === 'add') {
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: String(Number(args.a) + Number(args.b)) }] },
      })
      return
    }
    send({
      jsonrpc: '2.0',
      id,
      result: { isError: true, content: [{ type: 'text', text: `no tool ${name}` }] },
    })
    return
  }
  /* notifications have no id; anything else gets an empty result */
  if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} })
}

process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    try {
      handle(JSON.parse(line))
    } catch {
      /* a malformed line is not worth killing the server over */
    }
  }
})
