const API_BASE = process.env.API_BASE ?? 'https://api.lumenlayer.tech'

type StampErrorCode =
  | 'bundle_status_unavailable'
  | 'tx_signature_not_in_bundle'
  | 'anchor_signer_unavailable'
  | 'memo_anchor_failed'

type StampError = {
  error: StampErrorCode | string
  retryable?: boolean
}

type LumenReceipt = {
  receiptId: string
  txSignature: string
  bundleId: string
  slot: number
  confirmationStatus: 'confirmed' | 'finalized'
  receiptHash: string
  onChainMemo: string | null
  attestationLevel: 'BUNDLE_VERIFIED' | 'BAM_ATTESTED'
  walletAddress: string | null
  verified: boolean
  createdAt: number
  schemaVersion?: 'v2'
  executionQuality?: {
    score: number
    flags: string[]
    flagsBitmap: number
    algoVersion: 'eqs-v1'
  }
}

type StampInput = {
  txSignature: string
  bundleId: string
  walletAddress?: string | null
}

function describeStampError(body: StampError) {
  switch (body.error) {
    case 'bundle_status_unavailable':
      return 'Jito bundle status is temporarily unavailable. Retry later.'
    case 'tx_signature_not_in_bundle':
      return 'The transaction signature was not found in the submitted bundle.'
    case 'anchor_signer_unavailable':
      return 'Lumen could not access its memo anchor signer.'
    case 'memo_anchor_failed':
      return 'The receipt was built but the on-chain memo anchor failed.'
    default:
      return `Unexpected stamp error: ${body.error}`
  }
}

async function readJson(response: Response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

export async function stampReceipt(input: StampInput): Promise<LumenReceipt> {
  const response = await fetch(`${API_BASE}/api/v1/stamp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  const body = await readJson(response)

  if (!response.ok) {
    const errorBody = body as StampError
    const retry = errorBody.retryable ? ' retryable=true' : ''
    throw new Error(`${describeStampError(errorBody)}${retry}`)
  }

  return body as LumenReceipt
}

const sample = {
  txSignature: '4rLD5XfdvrmQJfKqVArBsGs7qCwCbhi8z53gkgCzMUAgvzGArTS4UP4qpN5fhM7r9uW19yM8d1Z8mcJwFLhzqcQW',
  bundleId: '030c9d74fa6adedbab3c8a124e26898de4fe555b6b6d349c47bf8fc0bea3e5cc',
  walletAddress: null,
}

try {
  const receipt = await stampReceipt(sample)
  console.log(JSON.stringify(receipt, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
