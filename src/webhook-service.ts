import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { db } from './db'
import type { LumenReceipt } from './receipt'
import {
  buildReceiptIssuedEvent,
  mapWebhookDeliveryRowToDelivery,
  mapWebhookSubscriptionRowToSubscription,
  type WebhookCreateResponse,
  type WebhookDeliveryListResponse,
  type WebhookDeliveryRow,
  type WebhookEventType,
  type WebhookSubscriptionRow,
} from './webhook'

const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000
const RECEIPT_ISSUED_EVENT_TYPE: WebhookEventType = 'receipt.issued'

export interface CreateWebhookSubscriptionInput {
  targetUrl: string
  eventType?: WebhookEventType
}

export interface WebhookSendRequest {
  url: string
  body: string
  headers: Record<string, string>
}

export type WebhookSendResult =
  | {
      ok: true
      responseStatus: number
    }
  | {
      ok: false
      responseStatus: number | null
      errorMessage: string
    }

export interface WebhookServiceDependencies {
  sendWebhookRequest?: (request: WebhookSendRequest) => Promise<WebhookSendResult>
}

function isWebhookFailureResult(
  result: WebhookSendResult
): result is Extract<WebhookSendResult, { ok: false }> {
  return result.ok === false
}

function normalizeTargetUrl(targetUrl: string) {
  try {
    const parsedUrl = new URL(targetUrl)

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('invalid_webhook_target_url')
    }

    return parsedUrl.toString()
  } catch (error) {
    throw new Error('invalid_webhook_target_url')
  }
}

function createSigningSecret() {
  return crypto.randomBytes(32).toString('hex')
}

function signWebhookBody(signingSecret: string, timestamp: string, body: string) {
  const signature = crypto
    .createHmac('sha256', signingSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex')

  return `sha256=${signature}`
}

async function defaultSendWebhookRequest(
  request: WebhookSendRequest
): Promise<WebhookSendResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_WEBHOOK_TIMEOUT_MS)

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        ok: false,
        responseStatus: response.status,
        errorMessage: `receiver_status_${response.status}`,
      }
    }

    return {
      ok: true,
      responseStatus: response.status,
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError'
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return {
      ok: false,
      responseStatus: null,
      errorMessage: errorName === 'AbortError'
        ? 'receiver_timeout'
        : `receiver_request_failed:${errorMessage}`,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function updateDeliveryStatus(
  deliveryId: string,
  status: 'delivered' | 'failed',
  responseStatus: number | null,
  errorMessage: string | null
) {
  const updatedAt = Date.now()

  db.prepare(`
    UPDATE webhook_deliveries
    SET status = ?, response_status = ?, error_message = ?, delivered_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    responseStatus,
    errorMessage,
    status === 'delivered' ? updatedAt : null,
    updatedAt,
    deliveryId
  )
}

async function deliverToSubscription(
  subscription: WebhookSubscriptionRow,
  receipt: LumenReceipt,
  eventId: string,
  deps: WebhookServiceDependencies
) {
  const createdAt = Date.now()
  const deliveryId = uuidv4()
  const event = buildReceiptIssuedEvent(eventId, receipt)
  const body = JSON.stringify(event)
  const timestamp = createdAt.toString()
  const signature = signWebhookBody(subscription.signing_secret, timestamp, body)

  db.prepare(`
    INSERT INTO webhook_deliveries (
      id,
      subscription_id,
      receipt_id,
      event_id,
      event_type,
      status,
      attempt_count,
      response_status,
      error_message,
      delivered_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    deliveryId,
    subscription.id,
    receipt.receiptId,
    eventId,
    RECEIPT_ISSUED_EVENT_TYPE,
    'pending',
    1,
    null,
    null,
    null,
    createdAt,
    createdAt
  )

  const sendWebhookRequest = deps.sendWebhookRequest ?? defaultSendWebhookRequest
  const result = await sendWebhookRequest({
    url: subscription.target_url,
    body,
    headers: {
      'content-type': 'application/json',
      'x-lumen-delivery-id': deliveryId,
      'x-lumen-event-type': RECEIPT_ISSUED_EVENT_TYPE,
      'x-lumen-signature': signature,
      'x-lumen-timestamp': timestamp,
    },
  })

  if (result.ok) {
    updateDeliveryStatus(deliveryId, 'delivered', result.responseStatus, null)
    return { deliveryId, status: 'delivered' as const }
  }

  if (isWebhookFailureResult(result)) {
    updateDeliveryStatus(
      deliveryId,
      'failed',
      result.responseStatus,
      result.errorMessage
    )

    return { deliveryId, status: 'failed' as const }
  }

  return { deliveryId, status: 'failed' as const }
}

export function createWebhookSubscription(
  input: CreateWebhookSubscriptionInput
): WebhookCreateResponse {
  const createdAt = Date.now()
  const subscriptionId = uuidv4()
  const eventType = input.eventType ?? RECEIPT_ISSUED_EVENT_TYPE
  const targetUrl = normalizeTargetUrl(input.targetUrl)
  const signingSecret = createSigningSecret()

  db.prepare(`
    INSERT INTO webhook_subscriptions (
      id,
      target_url,
      event_type,
      signing_secret,
      active,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    subscriptionId,
    targetUrl,
    eventType,
    signingSecret,
    1,
    createdAt,
    createdAt
  )

  const row = db.prepare(
    'SELECT * FROM webhook_subscriptions WHERE id = ?'
  ).get(subscriptionId) as WebhookSubscriptionRow

  return {
    subscription: mapWebhookSubscriptionRowToSubscription(row),
    signingSecret,
  }
}

export function getWebhookSubscription(
  subscriptionId: string
) {
  const row = db.prepare(
    'SELECT * FROM webhook_subscriptions WHERE id = ?'
  ).get(subscriptionId) as WebhookSubscriptionRow | undefined

  return row ? mapWebhookSubscriptionRowToSubscription(row) : null
}

export function listWebhookDeliveries(
  subscriptionId: string
): WebhookDeliveryListResponse | null {
  const subscription = getWebhookSubscription(subscriptionId)

  if (!subscription) {
    return null
  }

  const rows = db.prepare(`
    SELECT *
    FROM webhook_deliveries
    WHERE subscription_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(subscriptionId) as WebhookDeliveryRow[]

  return {
    subscription,
    deliveries: rows.map(mapWebhookDeliveryRowToDelivery),
    count: rows.length,
  }
}

export async function deliverReceiptIssuedEvent(
  receipt: LumenReceipt,
  deps: WebhookServiceDependencies = {}
) {
  const subscriptions = db.prepare(`
    SELECT *
    FROM webhook_subscriptions
    WHERE active = 1 AND event_type = ?
  `).all(RECEIPT_ISSUED_EVENT_TYPE) as WebhookSubscriptionRow[]

  if (subscriptions.length === 0) {
    return {
      eventId: null,
      deliveryCount: 0,
      deliveredCount: 0,
      failedCount: 0,
    }
  }

  const eventId = uuidv4()
  const deliveryResults = await Promise.allSettled(
    subscriptions.map(subscription =>
      deliverToSubscription(subscription, receipt, eventId, deps)
    )
  )

  const deliveredCount = deliveryResults.filter(
    result => result.status === 'fulfilled' && result.value.status === 'delivered'
  ).length
  const failedCount = deliveryResults.length - deliveredCount

  return {
    eventId,
    deliveryCount: deliveryResults.length,
    deliveredCount,
    failedCount,
  }
}
