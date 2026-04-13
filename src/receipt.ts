import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

export const receiptAttestationLevels = ['BUNDLE_VERIFIED', 'BAM_ATTESTED'] as const
export type ReceiptAttestationLevel = (typeof receiptAttestationLevels)[number]
export const receiptVerificationStatuses = [
  'UNANCHORED',
  'VERIFIED',
  'HASH_MISMATCH',
  'MEMO_MISMATCH',
  'ANCHOR_NOT_FOUND',
  'ANCHOR_LOOKUP_FAILED',
] as const
export type ReceiptVerificationStatus = (typeof receiptVerificationStatuses)[number]

export interface LumenReceipt {
  receiptId: string
  txSignature: string
  bundleId: string
  slot: number
  confirmationStatus: string
  receiptHash: string
  onChainMemo: string | null
  attestationLevel: ReceiptAttestationLevel
  walletAddress: string | null
  verified: boolean
  createdAt: number
}

export interface ReceiptRow {
  id: string
  tx_signature: string
  bundle_id: string
  slot: number
  confirmation_status: string
  receipt_hash: string
  on_chain_memo: string | null
  attestation_level: ReceiptAttestationLevel
  wallet_address: string | null
  verified: number | boolean | null
  created_at: number
}

const nullableStringSchema = { type: ['string', 'null'] }

export const receiptSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'receiptId',
    'txSignature',
    'bundleId',
    'slot',
    'confirmationStatus',
    'receiptHash',
    'onChainMemo',
    'attestationLevel',
    'walletAddress',
    'verified',
    'createdAt',
  ],
  properties: {
    receiptId: { type: 'string', minLength: 1 },
    txSignature: { type: 'string', minLength: 1 },
    bundleId: { type: 'string', minLength: 1 },
    slot: { type: 'integer' },
    confirmationStatus: { type: 'string', minLength: 1 },
    receiptHash: { type: 'string', minLength: 1 },
    onChainMemo: nullableStringSchema,
    attestationLevel: { type: 'string', enum: [...receiptAttestationLevels] },
    walletAddress: nullableStringSchema,
    verified: { type: 'boolean' },
    createdAt: { type: 'integer' },
  },
} as const

export const receiptListItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'receiptId', 'txSignature', 'bundleId', 'slot', 'confirmationStatus',
    'receiptHash', 'onChainMemo', 'attestationLevel', 'walletAddress', 'verified',
    'createdAt', 'verificationStatus',
  ],
  properties: {
    receiptId: { type: 'string', minLength: 1 },
    txSignature: { type: 'string', minLength: 1 },
    bundleId: { type: 'string', minLength: 1 },
    slot: { type: 'integer' },
    confirmationStatus: { type: 'string', minLength: 1 },
    receiptHash: { type: 'string', minLength: 1 },
    onChainMemo: { type: ['string', 'null'] },
    attestationLevel: { type: 'string', enum: [...receiptAttestationLevels] },
    walletAddress: { type: ['string', 'null'] },
    verified: { type: 'boolean' },
    createdAt: { type: 'integer' },
    verificationStatus: { type: 'string', enum: [...receiptVerificationStatuses] },
  },
} as const

export const receiptListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['receipts', 'count'],
  properties: {
    receipts: {
      type: 'array',
      items: receiptListItemSchema,
    },
    count: { type: 'integer' },
  },
} as const

// Compute SHA-256 hash of tx signature + bundle data
export function computeReceiptHash(
  txSignature: string,
  bundleId: string,
  slot: number
): string {
  return crypto
    .createHash('sha256')
    .update(`${txSignature}${bundleId}${slot}`)
    .digest('hex')
}

// Build a receipt object
export function buildReceipt(
  txSignature: string,
  bundleId: string,
  slot: number,
  confirmationStatus: string,
  walletAddress?: string
): LumenReceipt {
  const receiptHash = computeReceiptHash(txSignature, bundleId, slot)

  return {
    receiptId: uuidv4(),
    txSignature,
    bundleId,
    slot,
    confirmationStatus,
    receiptHash,
    onChainMemo: null,
    attestationLevel: 'BUNDLE_VERIFIED',
    walletAddress: walletAddress || null,
    verified: false,
    createdAt: Date.now(),
  }
}

export function deriveVerificationStatus(row: ReceiptRow): ReceiptVerificationStatus {
  if (row.on_chain_memo && row.verified) return 'VERIFIED'
  return 'UNANCHORED'
}

export function mapReceiptRowToReceipt(row: ReceiptRow): LumenReceipt {
  return {
    receiptId: row.id,
    txSignature: row.tx_signature,
    bundleId: row.bundle_id,
    slot: row.slot,
    confirmationStatus: row.confirmation_status,
    receiptHash: row.receipt_hash,
    onChainMemo: row.on_chain_memo,
    attestationLevel: row.attestation_level || 'BUNDLE_VERIFIED',
    walletAddress: row.wallet_address,
    verified: Boolean(row.verified) && Boolean(row.on_chain_memo),
    createdAt: row.created_at,
  }
}

export function getReceiptInsertParams(receipt: LumenReceipt) {
  return [
    receipt.receiptId,
    receipt.txSignature,
    receipt.bundleId,
    receipt.slot,
    receipt.confirmationStatus,
    receipt.receiptHash,
    receipt.onChainMemo,
    receipt.attestationLevel,
    receipt.walletAddress,
    receipt.verified ? 1 : 0,
    receipt.createdAt,
  ]
}
