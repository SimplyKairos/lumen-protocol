import 'dotenv/config'
import { Connection } from '@solana/web3.js'

const PRIMARY_RPC_URL = process.env.ALCHEMY_RPC_URL
const SECONDARY_RPC_URL = process.env.QUICKNODE_RPC_URL
const HELIUS_RPC_URL = process.env.SOLANA_NETWORK === 'devnet'
  ? process.env.HELIUS_RPC_DEVNET
  : process.env.HELIUS_RPC_MAINNET

function createConnection(url?: string) {
  return url ? new Connection(url, 'confirmed') : null
}

const primaryConnection = createConnection(PRIMARY_RPC_URL)
const secondaryConnection = createConnection(SECONDARY_RPC_URL)
const heliusConnection = createConnection(HELIUS_RPC_URL)

// Ordered list of available connections; callers iterate until one succeeds.
const rpcConnections = [primaryConnection, secondaryConnection, heliusConnection].filter(Boolean) as Connection[]

if (rpcConnections.length === 0) {
  throw new Error('No Solana RPC URLs configured. Set ALCHEMY_RPC_URL, QUICKNODE_RPC_URL, or HELIUS_RPC_MAINNET.')
}

export async function withConnectionFallback<T>(operation: (connection: Connection) => Promise<T>): Promise<T> {
  let lastError: unknown = null

  for (const connection of rpcConnections) {
    try {
      return await operation(connection)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('rpc_unavailable')
}

// Keep a stable export for callers that need a Connection object directly (e.g. submitBundle).
// This points to the first available connection; stamp/verify paths use withConnectionFallback instead.
export const connection = rpcConnections[0]

const JITO_URL = process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf'

export interface BundleData {
  bundleId: string
  slot: number
  confirmationStatus: string
  transactions: string[]
}

export type BundleLookupResult =
  | { status: 'ok'; data: BundleData }
  | { status: 'not_ready' }
  | { status: 'lookup_failed' }

function isBundleErrorOk(err: unknown) {
  return Boolean(
    err &&
    typeof err === 'object' &&
    'Ok' in (err as Record<string, unknown>) &&
    (err as Record<string, unknown>).Ok === null
  )
}

export async function getBundleData(bundleId: string): Promise<BundleLookupResult> {
  try {
    const response = await fetch(`${JITO_URL}/api/v1/getBundleStatuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]],
      }),
    })

    if (!response.ok) {
      console.error('Jito status lookup failed:', response.status)
      return { status: 'lookup_failed' }
    }

    const json = await response.json() as any

    if (json.error) {
      console.error('Jito error:', json.error)
      return { status: 'lookup_failed' }
    }

    const result = json?.result?.value?.[0]
    if (!result) {
      return { status: 'not_ready' }
    }

    const confirmationStatus = result.confirmationStatus ?? result.confirmation_status
    const transactions = Array.isArray(result.transactions) ? result.transactions : []
    const hasBundleError = result.err != null && !isBundleErrorOk(result.err)

    if (
      hasBundleError ||
      typeof result.bundle_id !== 'string' ||
      typeof result.slot !== 'number' ||
      typeof confirmationStatus !== 'string' ||
      transactions.length === 0
    ) {
      return { status: 'not_ready' }
    }

    return {
      status: 'ok',
      data: {
        bundleId: result.bundle_id,
        slot: result.slot,
        confirmationStatus,
        transactions,
      },
    }
  } catch (err) {
    console.error('getBundleData error:', err)
    return { status: 'lookup_failed' }
  }
}

export async function submitBundle(transactions: string[]): Promise<string | null> {
  try {
    const response = await fetch(`${JITO_URL}/api/v1/bundles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [transactions],
      }),
    })

    const json = await response.json() as any
    if (json.error) {
      console.error('Jito submit error:', json.error)
      return null
    }

    return json.result
  } catch (err) {
    console.error('submitBundle error:', err)
    return null
  }
}
