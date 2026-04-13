import { receiptSchema, type LumenReceipt } from './receipt'

export const webhookEventTypes = ['receipt.issued'] as const
export type WebhookEventType = (typeof webhookEventTypes)[number]

export const webhookDeliveryStatuses = ['pending', 'delivered', 'failed'] as const
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatuses)[number]

export interface WebhookSubscriptionRow {
  id: string
  target_url: string
  event_type: WebhookEventType
  signing_secret: string
  active: number | boolean | null
  created_at: number
  updated_at: number
}

export interface WebhookDeliveryRow {
  id: string
  subscription_id: string
  receipt_id: string
  event_id: string
  event_type: WebhookEventType
  status: WebhookDeliveryStatus
  attempt_count: number
  response_status: number | null
  error_message: string | null
  delivered_at: number | null
  created_at: number
  updated_at: number
}

export interface WebhookSubscription {
  subscriptionId: string
  targetUrl: string
  eventType: WebhookEventType
  active: boolean
  signingSecretMasked: string
  createdAt: number
  updatedAt: number
}

export interface WebhookCreateResponse {
  subscription: WebhookSubscription
  signingSecret: string
}

export interface ReceiptIssuedEvent {
  eventId: string
  eventType: 'receipt.issued'
  createdAt: number
  receipt: LumenReceipt
}

export interface WebhookDelivery {
  deliveryId: string
  subscriptionId: string
  receiptId: string
  eventId: string
  eventType: WebhookEventType
  status: WebhookDeliveryStatus
  attemptCount: number
  responseStatus: number | null
  errorMessage: string | null
  deliveredAt: number | null
  createdAt: number
  updatedAt: number
}

export interface WebhookDeliveryListResponse {
  subscription: WebhookSubscription
  deliveries: WebhookDelivery[]
  count: number
}

const nullableStringSchema = { type: ['string', 'null'] } as const
const nullableIntegerSchema = { type: ['integer', 'null'] } as const

export const webhookSubscriptionCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['targetUrl'],
  properties: {
    targetUrl: { type: 'string', minLength: 1, format: 'uri' },
    eventType: { type: 'string', enum: [...webhookEventTypes] },
  },
} as const

export const webhookSubscriptionParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subscriptionId'],
  properties: {
    subscriptionId: { type: 'string', minLength: 1 },
  },
} as const

export const webhookSubscriptionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'subscriptionId',
    'targetUrl',
    'eventType',
    'active',
    'signingSecretMasked',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    subscriptionId: { type: 'string', minLength: 1 },
    targetUrl: { type: 'string', minLength: 1 },
    eventType: { type: 'string', enum: [...webhookEventTypes] },
    active: { type: 'boolean' },
    signingSecretMasked: { type: 'string', minLength: 1 },
    createdAt: { type: 'integer' },
    updatedAt: { type: 'integer' },
  },
} as const

export const webhookCreateResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subscription', 'signingSecret'],
  properties: {
    subscription: webhookSubscriptionSchema,
    signingSecret: { type: 'string', minLength: 1 },
  },
} as const

export const receiptIssuedEventSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId', 'eventType', 'createdAt', 'receipt'],
  properties: {
    eventId: { type: 'string', minLength: 1 },
    eventType: { type: 'string', enum: ['receipt.issued'] },
    createdAt: { type: 'integer' },
    receipt: receiptSchema,
  },
} as const

export const webhookDeliverySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'deliveryId',
    'subscriptionId',
    'receiptId',
    'eventId',
    'eventType',
    'status',
    'attemptCount',
    'responseStatus',
    'errorMessage',
    'deliveredAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    deliveryId: { type: 'string', minLength: 1 },
    subscriptionId: { type: 'string', minLength: 1 },
    receiptId: { type: 'string', minLength: 1 },
    eventId: { type: 'string', minLength: 1 },
    eventType: { type: 'string', enum: [...webhookEventTypes] },
    status: { type: 'string', enum: [...webhookDeliveryStatuses] },
    attemptCount: { type: 'integer' },
    responseStatus: nullableIntegerSchema,
    errorMessage: nullableStringSchema,
    deliveredAt: nullableIntegerSchema,
    createdAt: { type: 'integer' },
    updatedAt: { type: 'integer' },
  },
} as const

export const webhookDeliveryListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subscription', 'deliveries', 'count'],
  properties: {
    subscription: webhookSubscriptionSchema,
    deliveries: {
      type: 'array',
      items: webhookDeliverySchema,
    },
    count: { type: 'integer' },
  },
} as const

export function maskSigningSecret(signingSecret: string) {
  if (signingSecret.length <= 10) {
    return '••••'
  }

  return `${signingSecret.slice(0, 6)}...${signingSecret.slice(-4)}`
}

export function mapWebhookSubscriptionRowToSubscription(
  row: WebhookSubscriptionRow
): WebhookSubscription {
  return {
    subscriptionId: row.id,
    targetUrl: row.target_url,
    eventType: row.event_type,
    active: Boolean(row.active),
    signingSecretMasked: maskSigningSecret(row.signing_secret),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapWebhookDeliveryRowToDelivery(
  row: WebhookDeliveryRow
): WebhookDelivery {
  return {
    deliveryId: row.id,
    subscriptionId: row.subscription_id,
    receiptId: row.receipt_id,
    eventId: row.event_id,
    eventType: row.event_type,
    status: row.status,
    attemptCount: row.attempt_count,
    responseStatus: row.response_status,
    errorMessage: row.error_message,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function buildReceiptIssuedEvent(
  eventId: string,
  receipt: LumenReceipt
): ReceiptIssuedEvent {
  return {
    eventId,
    eventType: 'receipt.issued',
    createdAt: Date.now(),
    receipt,
  }
}
