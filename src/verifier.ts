import { db } from './db'
import {
  computeReceiptHash,
  mapReceiptRowToReceipt,
  receiptVerificationStatuses,
  type ReceiptVerificationStatus,
  type ReceiptRow,
  receiptSchema,
} from './receipt'
import {
  getMemoTransactionData,
  type MemoTransactionLookupResult,
} from './memo-service'

export interface VerificationResult {
  verified: boolean
  verificationStatus: ReceiptVerificationStatus
  hashMatches: boolean
  memoMatches: boolean
  receiptId: string
  txSignature: string
  bundleId: string
  slot: number
  confirmationStatus: string
  attestationLevel: string
  onChainMemo: string | null
  createdAt: number
  error?: string
}

export interface VerificationDependencies {
  getMemoTransactionData?: (signature: string) => Promise<MemoTransactionLookupResult>
}

export const verificationResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...receiptSchema.required, 'verificationStatus', 'hashMatches', 'memoMatches'],
  properties: {
    ...receiptSchema.properties,
    verificationStatus: { type: 'string', enum: [...receiptVerificationStatuses] },
    hashMatches: { type: 'boolean' },
    memoMatches: { type: 'boolean' },
    error: { type: 'string' },
  },
} as const

function persistVerifiedState(receiptId: string, verificationStatus: ReceiptVerificationStatus) {
  db.prepare('UPDATE receipts SET verified = ? WHERE id = ?').run(
    verificationStatus === 'VERIFIED' ? 1 : 0,
    receiptId
  )
}

// Verify a receipt by ID
export async function verifyReceipt(
  receiptId: string,
  deps: VerificationDependencies = {}
): Promise<VerificationResult | null> {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId) as ReceiptRow | undefined

  if (!receipt) return null

  const recomputedHash = computeReceiptHash(
    receipt.tx_signature,
    receipt.bundle_id,
    receipt.slot
  )

  const hashMatches = recomputedHash === receipt.receipt_hash
  const mappedReceipt = mapReceiptRowToReceipt(receipt)

  if (!hashMatches) {
    const verificationStatus: ReceiptVerificationStatus = 'HASH_MISMATCH'
    persistVerifiedState(receiptId, verificationStatus)

    return {
      ...mappedReceipt,
      verified: false,
      verificationStatus,
      hashMatches,
      memoMatches: false,
      error: 'receipt_hash_mismatch',
    }
  }

  if (!receipt.on_chain_memo) {
    const verificationStatus: ReceiptVerificationStatus = 'UNANCHORED'
    persistVerifiedState(receiptId, verificationStatus)

    return {
      ...mappedReceipt,
      verified: false,
      verificationStatus,
      hashMatches,
      memoMatches: false,
      error: 'receipt_unanchored',
    }
  }

  const memoLookup = await (deps.getMemoTransactionData ?? getMemoTransactionData)(receipt.on_chain_memo)

  if (memoLookup.status === 'lookup_failed') {
    const verificationStatus: ReceiptVerificationStatus = 'ANCHOR_LOOKUP_FAILED'
    persistVerifiedState(receiptId, verificationStatus)

    return {
      ...mappedReceipt,
      verified: false,
      verificationStatus,
      hashMatches,
      memoMatches: false,
      error: 'anchor_lookup_failed',
    }
  }

  if (memoLookup.status === 'not_found') {
    const verificationStatus: ReceiptVerificationStatus = 'ANCHOR_NOT_FOUND'
    persistVerifiedState(receiptId, verificationStatus)

    return {
      ...mappedReceipt,
      verified: false,
      verificationStatus,
      hashMatches,
      memoMatches: false,
      error: 'anchor_not_found',
    }
  }

  const memoMatches = memoLookup.data.memoText === receipt.receipt_hash
  const verificationStatus: ReceiptVerificationStatus = memoMatches ? 'VERIFIED' : 'MEMO_MISMATCH'
  persistVerifiedState(receiptId, verificationStatus)

  return {
    ...mappedReceipt,
    verified: verificationStatus === 'VERIFIED',
    verificationStatus,
    hashMatches,
    memoMatches,
    ...(memoMatches ? {} : { error: 'memo_payload_mismatch' }),
  }
}
