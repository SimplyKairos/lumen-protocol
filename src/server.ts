import { db } from './db'
import {
  deriveVerificationStatus,
  getReceiptInsertParams,
  mapReceiptRowToReceipt,
  receiptListSchema,
  receiptSchema,
  type ReceiptRow,
} from './receipt'
import {
  verifyReceipt,
  verificationResultSchema,
  type VerificationDependencies,
} from './verifier'
import { createStampedReceipt, type StampServiceDependencies } from './stamp-service'
import {
  createWebhookSubscription,
  deliverReceiptIssuedEvent,
  getWebhookSubscription,
  listWebhookDeliveries,
  type WebhookServiceDependencies,
} from './webhook-service'
import {
  webhookCreateResponseSchema,
  webhookDeliveryListSchema,
  webhookSubscriptionCreateBodySchema,
  webhookSubscriptionParamsSchema,
} from './webhook'
import { blinkRoutes } from './routes/blinks'
import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'

const stampBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['txSignature', 'bundleId'],
  properties: {
    txSignature: { type: 'string', minLength: 1 },
    bundleId: { type: 'string', minLength: 1 },
    walletAddress: { type: ['string', 'null'] },
  },
} as const

const receiptIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['receiptId'],
  properties: {
    receiptId: { type: 'string', minLength: 1 },
  },
} as const

const apiErrorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: { type: 'string' },
    retryable: { type: 'boolean' },
  },
} as const

const stampErrorCodes = [
  'bundle_status_unavailable',
  'tx_signature_not_in_bundle',
  'anchor_signer_unavailable',
  'memo_anchor_failed',
] as const

const stampErrorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: { type: 'string', enum: [...stampErrorCodes] },
    retryable: { type: 'boolean' },
  },
} as const

function isUniqueTxConstraintError(err: unknown) {
  return err instanceof Error && err.message.includes('receipts.tx_signature')
}

export interface BuildServerDependencies
  extends
    StampServiceDependencies,
    VerificationDependencies,
    WebhookServiceDependencies {}

export function buildServer(deps: BuildServerDependencies = {}) {
  const server = Fastify({ logger: true })

  server.register(cors, {
    origin: '*'
  })

  server.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      error: `Rate limit exceeded. Maximum ${context.max} stamp requests per minute per IP.`,
    }),
  })

  server.register(blinkRoutes)

  // Health check
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  server.get('/', async (_request, reply) => {
    return reply.send({
      name: 'Lumen Protocol API',
      version: '1.0.0',
      description: 'Open execution fairness protocol for Solana',
      docs: 'https://github.com/SimplyKairos/lumen-protocol',
      endpoints: {
        stamp: 'POST /api/v1/stamp',
        verify: 'GET /api/v1/verify/:receiptId',
        receipts: 'GET /api/v1/receipts',
        webhooks: 'POST /api/v1/webhooks',
        blinks: 'GET /api/v1/blink/verify/:receiptId'
      }
    })
  })

  // Solana Blinks actions manifest
  server.get('/actions.json', async (_request, reply) => {
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept-Encoding')
      .header('Content-Type', 'application/json')
      .send({
        rules: [
          {
            pathPattern: '/api/v1/blink/**',
            apiPath: '/api/v1/blink/**'
          }
        ]
      })
  })

  // PROTOCOL ROUTES
  // POST /api/v1/stamp — submit a transaction for receipt generation
  server.post('/api/v1/stamp', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
    schema: {
      body: stampBodySchema,
      response: {
        200: receiptSchema,
        201: receiptSchema,
        400: apiErrorSchema,
        422: stampErrorSchema,
        429: apiErrorSchema,
        503: stampErrorSchema,
        500: stampErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { txSignature, bundleId, walletAddress } = request.body as {
      txSignature: string
      bundleId: string
      walletAddress?: string | null
    }

    try {
      const existingReceipt = db.prepare(
        'SELECT * FROM receipts WHERE tx_signature = ?'
      ).get(txSignature) as ReceiptRow | undefined

      if (existingReceipt) {
        return reply.code(200).send(mapReceiptRowToReceipt(existingReceipt))
      }

      const stampResult = await createStampedReceipt({
        txSignature,
        bundleId,
        walletAddress,
      }, deps)

      if ('statusCode' in stampResult) {
        return reply.code(stampResult.statusCode).send({
          error: stampResult.error,
          retryable: stampResult.retryable,
        })
      }

      db.prepare(`
        INSERT INTO receipts (id, tx_signature, bundle_id, slot, confirmation_status, receipt_hash, on_chain_memo, attestation_level, wallet_address, verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...getReceiptInsertParams(stampResult.receipt))

      try {
        await deliverReceiptIssuedEvent(stampResult.receipt, deps)
      } catch (deliveryError) {
        server.log.error(
          { err: deliveryError, receiptId: stampResult.receipt.receiptId },
          'Failed to deliver receipt-issued webhooks'
        )
      }

      return reply.code(201).send(stampResult.receipt)
    } catch (err) {
      if (isUniqueTxConstraintError(err)) {
        const existingReceipt = db.prepare(
          'SELECT * FROM receipts WHERE tx_signature = ?'
        ).get(txSignature) as ReceiptRow | undefined

        if (existingReceipt) {
          return reply.code(200).send(mapReceiptRowToReceipt(existingReceipt))
        }
      }

      server.log.error(err)
      return reply.code(500).send({ error: 'Failed to create receipt' })
    }
  })

  // GET /api/v1/verify/:receiptId — verify a receipt
  server.get('/api/v1/verify/:receiptId', {
    schema: {
      params: receiptIdParamsSchema,
      response: {
        200: verificationResultSchema,
        404: apiErrorSchema,
        500: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { receiptId } = request.params as { receiptId: string }

    try {
      const result = await verifyReceipt(receiptId, deps)
      if (!result) return reply.code(404).send({ error: 'Receipt not found' })
      return reply.send(result)
    } catch (err) {
      server.log.error(err)
      return reply.code(500).send({ error: 'Verification failed' })
    }
  })

  // GET /api/v1/receipts — list recent receipts
  server.get('/api/v1/receipts', {
    schema: {
      response: {
        200: receiptListSchema,
        500: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const rows = db.prepare(
        'SELECT * FROM receipts ORDER BY created_at DESC LIMIT 50'
      ).all() as ReceiptRow[]

      return reply.send({
        receipts: rows.map(row => ({
          ...mapReceiptRowToReceipt(row),
          verificationStatus: deriveVerificationStatus(row),
        })),
        count: rows.length,
      })
    } catch (err) {
      server.log.error(err)
      return reply.code(500).send({ error: 'Failed to fetch receipts' })
    }
  })

  // WEBHOOK ROUTE
  // POST /api/v1/webhooks — register an external receipt-issued webhook
  server.post('/api/v1/webhooks', {
    schema: {
      body: webhookSubscriptionCreateBodySchema,
      response: {
        201: webhookCreateResponseSchema,
        400: apiErrorSchema,
        500: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { targetUrl, eventType } = request.body as {
      targetUrl: string
      eventType?: 'receipt.issued'
    }

    try {
      const subscription = createWebhookSubscription({
        targetUrl,
        eventType,
      })

      return reply.code(201).send(subscription)
    } catch (err) {
      if (err instanceof Error && err.message === 'invalid_webhook_target_url') {
        return reply.code(400).send({ error: 'Invalid webhook target URL' })
      }

      server.log.error(err)
      return reply.code(500).send({ error: 'Failed to create webhook subscription' })
    }
  })

  // GET /api/v1/webhooks/:subscriptionId/deliveries — inspect delivery history for one subscription
  server.get('/api/v1/webhooks/:subscriptionId/deliveries', {
    schema: {
      params: webhookSubscriptionParamsSchema,
      response: {
        200: webhookDeliveryListSchema,
        404: apiErrorSchema,
        500: apiErrorSchema,
      },
    },
  }, async (request, reply) => {
    const { subscriptionId } = request.params as { subscriptionId: string }

    try {
      const subscription = getWebhookSubscription(subscriptionId)

      if (!subscription) {
        return reply.code(404).send({ error: 'Webhook subscription not found' })
      }

      const deliveryHistory = listWebhookDeliveries(subscriptionId)

      if (!deliveryHistory) {
        return reply.code(404).send({ error: 'Webhook subscription not found' })
      }

      return reply.send(deliveryHistory)
    } catch (err) {
      server.log.error(err)
      return reply.code(500).send({ error: 'Failed to fetch webhook deliveries' })
    }
  })

  return server
}

// Start server
export const start = async () => {
  const REQUIRED_ENV_VARS = ['ALCHEMY_RPC_URL', 'HELIUS_RPC_MAINNET', 'BACKEND_KEYPAIR', 'JITO_BLOCK_ENGINE_URL'] as const
  const missingVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key])

  if (missingVars.length > 0) {
    console.error(`[startup] Missing required environment variables: ${missingVars.join(', ')}`)
    console.error('[startup] Server will not start. Set all required env vars and retry.')
    process.exit(1)
  }

  const port = Number(process.env.PORT) || 3001
  const server = buildServer()

  try {
    await server.listen({ port, host: '0.0.0.0' })
    console.log(`Lumen API running on port ${port}`)
    return server
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

if (require.main === module) {
  start()
}
