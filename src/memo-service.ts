import 'dotenv/config'
import { createMemoInstruction, MEMO_PROGRAM_ID } from '@solana/spl-memo'
import {
  Keypair,
  Transaction,
  type Connection,
  type VersionedTransactionResponse,
} from '@solana/web3.js'
import { withConnectionFallback } from './bam-service'

async function sendAndPollConfirmation(
  conn: Connection,
  transaction: Transaction,
  signers: Keypair[]
): Promise<string> {
  transaction.sign(...signers)
  const rawTx = transaction.serialize()
  const signature = await conn.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  })

  const MAX_ATTEMPTS = 15
  const POLL_INTERVAL_MS = 2000

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { value } = await conn.getSignatureStatuses([signature])
    const status = value[0]

    if (status !== null && status !== undefined) {
      if (status.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`)
      }
      const level = status.confirmationStatus
      if (level === 'confirmed' || level === 'finalized') {
        return signature
      }
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  // Confirmation not received within polling window — treat as confirmed and continue.
  console.warn(`Transaction ${signature} not confirmed after ${MAX_ATTEMPTS} attempts, proceeding anyway`)
  return signature
}

export interface MemoTransactionData {
  signature: string
  memoText: string | null
  slot: number
}

export type MemoTransactionLookupResult =
  | { status: 'ok'; data: MemoTransactionData }
  | { status: 'not_found' }
  | { status: 'lookup_failed' }

export type AnchorReceiptHashResult =
  | { ok: true; memoSignature: string }
  | {
      ok: false
      error: 'anchor_signer_unavailable' | 'memo_anchor_failed'
      retryable: boolean
    }

function loadProtocolSigner() {
  const keypairValue = process.env.BACKEND_KEYPAIR

  if (!keypairValue) {
    return null
  }

  try {
    const parsedKeypair = JSON.parse(keypairValue)

    if (!Array.isArray(parsedKeypair)) {
      return null
    }

    return Keypair.fromSecretKey(Uint8Array.from(parsedKeypair))
  } catch (error) {
    console.error('Failed to load BACKEND_KEYPAIR:', error)
    return null
  }
}

function extractMemoText(transaction: VersionedTransactionResponse) {
  const accountKeys = transaction.transaction.message.version === 0
    ? transaction.transaction.message.getAccountKeys({
        accountKeysFromLookups: transaction.meta?.loadedAddresses,
      })
    : transaction.transaction.message.getAccountKeys()

  const memoInstruction = transaction.transaction.message.compiledInstructions.find(
    (instruction) => accountKeys.get(instruction.programIdIndex)?.equals(MEMO_PROGRAM_ID)
  )

  if (!memoInstruction) {
    return null
  }

  return Buffer.from(memoInstruction.data).toString('utf8')
}

export async function getMemoTransactionData(
  signature: string
): Promise<MemoTransactionLookupResult> {
  try {
    const transaction = await withConnectionFallback((conn) =>
      conn.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
    )

    if (!transaction) {
      return { status: 'not_found' }
    }

    return {
      status: 'ok',
      data: {
        signature,
        memoText: extractMemoText(transaction),
        slot: transaction.slot,
      },
    }
  } catch (error) {
    console.error('Failed to fetch memo transaction:', error)
    return { status: 'lookup_failed' }
  }
}

export async function anchorReceiptHash(
  receiptHash: string
): Promise<AnchorReceiptHashResult> {
  const signer = loadProtocolSigner()

  if (!signer) {
    return {
      ok: false,
      error: 'anchor_signer_unavailable',
      retryable: false,
    }
  }

  try {
    const { blockhash, lastValidBlockHeight } = await withConnectionFallback((conn) =>
      conn.getLatestBlockhash('confirmed')
    )

    const transaction = new Transaction({
      feePayer: signer.publicKey,
      recentBlockhash: blockhash,
    }).add(createMemoInstruction(receiptHash))
    transaction.lastValidBlockHeight = lastValidBlockHeight

    const memoSignature = await withConnectionFallback((conn) =>
      sendAndPollConfirmation(conn, transaction, [signer])
    )

    const memoTransaction = await getMemoTransactionData(memoSignature)

    if (
      memoTransaction.status !== 'ok' ||
      memoTransaction.data.memoText !== receiptHash
    ) {
      return {
        ok: false,
        error: 'memo_anchor_failed',
        retryable: true,
      }
    }

    return {
      ok: true,
      memoSignature,
    }
  } catch (error) {
    console.error('Failed to anchor receipt hash:', error)
    return {
      ok: false,
      error: 'memo_anchor_failed',
      retryable: true,
    }
  }
}
