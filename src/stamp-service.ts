import { buildReceipt, type LumenReceipt } from './receipt'
import { getBundleData, type BundleLookupResult } from './bam-service'
import { anchorReceiptHash, type AnchorReceiptHashResult } from './memo-service'

export interface StampRequestInput {
  txSignature: string
  bundleId: string
  walletAddress?: string | null
}

export interface StampServiceDependencies {
  getBundleData?: (bundleId: string) => Promise<BundleLookupResult>
  anchorReceiptHash?: (receiptHash: string) => Promise<AnchorReceiptHashResult>
}

export type StampResult =
  | {
      ok: true
      receipt: LumenReceipt
    }
  | {
      ok: false
      statusCode: 500 | 503 | 422
      error:
        | 'bundle_status_unavailable'
        | 'tx_signature_not_in_bundle'
        | 'anchor_signer_unavailable'
        | 'memo_anchor_failed'
      retryable: boolean
    }

export async function createStampedReceipt(
  input: StampRequestInput,
  deps: StampServiceDependencies = {}
): Promise<StampResult> {
  const bundleLookup = await (deps.getBundleData ?? getBundleData)(input.bundleId)

  if (bundleLookup.status !== 'ok') {
    return {
      ok: false,
      statusCode: 503,
      error: 'bundle_status_unavailable',
      retryable: true,
    }
  }

  if (!bundleLookup.data.transactions.includes(input.txSignature)) {
    return {
      ok: false,
      statusCode: 422,
      error: 'tx_signature_not_in_bundle',
      retryable: false,
    }
  }

  const receipt = buildReceipt(
    input.txSignature,
    bundleLookup.data.bundleId,
    bundleLookup.data.slot,
    bundleLookup.data.confirmationStatus,
    input.walletAddress ?? undefined
  )

  const anchorResult = await (deps.anchorReceiptHash ?? anchorReceiptHash)(receipt.receiptHash)

  if ('error' in anchorResult) {
    return {
      ok: false,
      statusCode: anchorResult.error === 'anchor_signer_unavailable' ? 500 : 503,
      error: anchorResult.error,
      retryable: anchorResult.retryable,
    }
  }

  return {
    ok: true,
    receipt: {
      ...receipt,
      onChainMemo: anchorResult.memoSignature,
      verified: true,
    },
  }
}
