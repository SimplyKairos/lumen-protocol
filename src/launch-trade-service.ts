import { db } from './db'
import { recordBundlerAlert } from './bundler-alert-service'
import {
  executeLaunchTrade,
  type DbcServiceDependencies,
} from './dbc-service'
import {
  getLaunchById,
  getProtectedWindowState,
  type LaunchServiceDependencies,
} from './launch-service'
import {
  mapReceiptRowToReceipt,
  type LumenReceipt,
  type ReceiptRow,
} from './receipt'
import {
  createStampedReceipt,
  type StampServiceDependencies,
} from './stamp-service'
import {
  deliverReceiptIssuedEvent,
  type WebhookServiceDependencies,
} from './webhook-service'
import type {
  LaunchTradeBody,
  LaunchTradeResponse,
} from './launch'

type TradeReceiptRow = ReceiptRow & {
  launch_id: string | null
}

export interface LaunchTradeRequestInput extends LaunchTradeBody {
  launchId: string
}

export interface LaunchTradeServiceDependencies
  extends
    DbcServiceDependencies,
    LaunchServiceDependencies,
    StampServiceDependencies,
    WebhookServiceDependencies {}

export type LaunchTradeResult =
  | {
      ok: true
      response: LaunchTradeResponse
      duplicate: boolean
    }
  | {
      ok: false
      statusCode: 404 | 409 | 422 | 500 | 503
      error:
        | 'launch_not_found'
        | 'launch_not_live'
        | 'tx_signature_already_linked'
        | 'bundle_status_unavailable'
        | 'tx_signature_not_in_bundle'
        | 'anchor_signer_unavailable'
        | 'memo_anchor_failed'
      retryable: boolean
    }

function persistLaunchReceipt(receipt: LumenReceipt, launchId: string) {
  db.prepare(`
    INSERT INTO receipts (
      id,
      tx_signature,
      bundle_id,
      slot,
      confirmation_status,
      receipt_hash,
      on_chain_memo,
      attestation_level,
      launch_id,
      wallet_address,
      verified,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receipt.receiptId,
    receipt.txSignature,
    receipt.bundleId,
    receipt.slot,
    receipt.confirmationStatus,
    receipt.receiptHash,
    receipt.onChainMemo,
    receipt.attestationLevel,
    launchId,
    receipt.walletAddress,
    receipt.verified ? 1 : 0,
    receipt.createdAt
  )
}

function buildDuplicateTrade(
  input: LaunchTradeRequestInput,
  receipt: TradeReceiptRow
) {
  return {
    side: input.side,
    amountIn: input.amountIn,
    minAmountOut: input.minAmountOut,
    walletAddress: input.walletAddress ?? receipt.wallet_address ?? null,
    executedAt: receipt.created_at,
  }
}

export async function createLaunchTradeReceipt(
  input: LaunchTradeRequestInput,
  deps: LaunchTradeServiceDependencies = {}
): Promise<LaunchTradeResult> {
  const launch = getLaunchById(input.launchId)

  if (!launch) {
    return {
      ok: false,
      statusCode: 404,
      error: 'launch_not_found',
      retryable: false,
    }
  }

  if (launch.status !== 'live') {
    return {
      ok: false,
      statusCode: 409,
      error: 'launch_not_live',
      retryable: false,
    }
  }

  const existingReceipt = db.prepare(`
    SELECT *
    FROM receipts
    WHERE tx_signature = ?
  `).get(input.txSignature) as TradeReceiptRow | undefined

  if (existingReceipt) {
    if (existingReceipt.launch_id && existingReceipt.launch_id !== input.launchId) {
      return {
        ok: false,
        statusCode: 409,
        error: 'tx_signature_already_linked',
        retryable: false,
      }
    }

    if (!existingReceipt.launch_id) {
      db.prepare(`
        UPDATE receipts
        SET launch_id = ?
        WHERE id = ?
      `).run(input.launchId, existingReceipt.id)
    }

    const refreshedReceipt = db.prepare(`
      SELECT *
      FROM receipts
      WHERE id = ?
    `).get(existingReceipt.id) as TradeReceiptRow

    return {
      ok: true,
      duplicate: true,
      response: {
        launch: getLaunchById(input.launchId) ?? launch,
        receipt: mapReceiptRowToReceipt(refreshedReceipt),
        trade: buildDuplicateTrade(input, refreshedReceipt),
      },
    }
  }

  const trade = await executeLaunchTrade(
    {
      launchId: input.launchId,
      txSignature: input.txSignature,
      bundleId: input.bundleId,
      walletAddress: input.walletAddress ?? null,
      side: input.side,
      amountIn: input.amountIn,
      minAmountOut: input.minAmountOut,
    },
    deps
  )

  const stampResult = await createStampedReceipt(
    {
      txSignature: input.txSignature,
      bundleId: input.bundleId,
      walletAddress: input.walletAddress ?? null,
    },
    deps
  )

  if (stampResult.ok === false) {
    return {
      ok: false,
      statusCode: stampResult.statusCode,
      error: stampResult.error,
      retryable: stampResult.retryable,
    }
  }

  persistLaunchReceipt(stampResult.receipt, input.launchId)
  const protectedWindowState = getProtectedWindowState(launch, {
    now: () => trade.executedAt,
  })

  if (protectedWindowState.protectedWindowActive) {
    recordBundlerAlert({
      launch,
      receipt: stampResult.receipt,
      trade,
    })
  }

  try {
    await deliverReceiptIssuedEvent(stampResult.receipt, deps)
  } catch (error) {
    // Receipt truth is independent from webhook delivery.
  }

  return {
    ok: true,
    duplicate: false,
    response: {
      launch: getLaunchById(input.launchId) ?? launch,
      receipt: stampResult.receipt,
      trade,
    },
  }
}
