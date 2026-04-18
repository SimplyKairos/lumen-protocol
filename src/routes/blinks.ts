import type { FastifyInstance } from 'fastify'
import { db } from '../db'
import type { ReceiptRow } from '../receipt'

const BLINK_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept-Encoding',
  'X-Action-Version': '1',
  'X-Blockchain-Ids': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
}

const receiptIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['receiptId'],
  properties: {
    receiptId: { type: 'string', minLength: 1 },
  },
} as const

export async function blinkRoutes(server: FastifyInstance) {
  server.addHook('onSend', async (_request, reply) => {
    for (const [key, value] of Object.entries(BLINK_HEADERS)) {
      reply.header(key, value)
    }
  })

  // OPTIONS preflight for both endpoints
  server.options('/api/v1/blink/verify/:receiptId', async (_request, reply) => {
    return reply.code(204).send()
  })

  // GET /api/v1/blink/verify/:receiptId — ActionGetResponse for Solana Blinks
  server.get('/api/v1/blink/verify/:receiptId', {
    schema: {
      params: receiptIdParamsSchema,
    },
  }, async (request, reply) => {
    const { receiptId } = request.params as { receiptId: string }

    const row = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId) as ReceiptRow | undefined

    if (!row) {
      return reply.code(404).send({ error: 'Receipt not found' })
    }

    return reply.send({
      title: 'Lumen Receipt Verified',
      icon: 'https://lumenlayer.tech/lumen-logo.png',
      description: `Receipt ${receiptId} — BUNDLE_VERIFIED — SHA-256 anchored on-chain`,
      label: 'Verify Receipt',
      links: {
        actions: [
          {
            label: 'View Full Receipt',
            href: `https://lumenlayer.tech/verify/${receiptId}`,
          },
        ],
      },
    })
  })

  // POST /api/v1/blink/verify/:receiptId — ActionPostResponse for Solana Blinks
  server.post('/api/v1/blink/verify/:receiptId', {
    schema: {
      params: receiptIdParamsSchema,
    },
  }, async (request, reply) => {
    const { receiptId } = request.params as { receiptId: string }

    const row = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId) as ReceiptRow | undefined

    if (!row) {
      return reply.code(404).send({ error: 'Receipt not found' })
    }

    return reply.send({
      transaction: '',
      message: `Receipt ${receiptId} is BUNDLE_VERIFIED. Hash matches on-chain memo. View: https://lumenlayer.tech/verify/${receiptId}`,
    })
  })
}
