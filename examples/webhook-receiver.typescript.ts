import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const signingSecret = process.env.LUMEN_WEBHOOK_SECRET
const port = Number(process.env.PORT ?? 8787)
const replayWindowMs = 5 * 60 * 1000

if (!signingSecret) {
  throw new Error('Set LUMEN_WEBHOOK_SECRET before starting the receiver.')
}

function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('error', reject)
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

function verifySignature(rawBody: string, signature: string, timestamp: string) {
  if (!signature.startsWith('sha256=')) return false

  const timestampMs = Number(timestamp)
  if (!Number.isFinite(timestampMs)) return false
  if (Math.abs(Date.now() - timestampMs) > replayWindowMs) return false

  const expectedHex = createHmac('sha256', signingSecret!)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  const received = Buffer.from(signature.slice('sha256='.length), 'hex')
  const expected = Buffer.from(expectedHex, 'hex')

  return received.length === expected.length && timingSafeEqual(received, expected)
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' })
    response.end('method not allowed')
    return
  }

  const rawBody = await readBody(request)
  const signature = request.headers['x-lumen-signature']
  const timestamp = request.headers['x-lumen-timestamp']

  if (typeof signature !== 'string' || typeof timestamp !== 'string') {
    response.writeHead(400)
    response.end('missing signature headers')
    return
  }

  if (!verifySignature(rawBody, signature, timestamp)) {
    response.writeHead(401)
    response.end('invalid signature')
    return
  }

  const event = JSON.parse(rawBody)
  console.log('verified receipt', event.receipt)

  response.writeHead(204)
  response.end()
})

server.listen(port, () => {
  console.log(`Lumen webhook receiver listening on http://127.0.0.1:${port}`)
})
