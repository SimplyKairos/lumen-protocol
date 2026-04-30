const API_BASE = process.env.API_BASE ?? 'https://api.lumenlayer.tech'

type VerificationStatus =
  | 'VERIFIED'
  | 'HASH_MISMATCH'
  | 'MEMO_MISMATCH'
  | 'ANCHOR_NOT_FOUND'
  | 'ANCHOR_LOOKUP_FAILED'
  | 'UNANCHORED'

type VerifyResponse = {
  receiptId: string
  receiptHash: string
  verificationStatus: VerificationStatus
  hashMatches: boolean
  memoMatches: boolean
  verified: boolean
  error?: string
}

function explain(status: VerificationStatus) {
  switch (status) {
    case 'VERIFIED':
      return 'Receipt hash and on-chain memo both match.'
    case 'HASH_MISMATCH':
      return 'Receipt fields do not recompute to receiptHash.'
    case 'MEMO_MISMATCH':
      return 'The memo transaction exists but does not contain receiptHash.'
    case 'ANCHOR_NOT_FOUND':
      return 'The memo transaction was not found on chain.'
    case 'ANCHOR_LOOKUP_FAILED':
      return 'The Solana RPC lookup failed while checking the memo.'
    case 'UNANCHORED':
      return 'The receipt has not been anchored on chain yet.'
  }
}

export async function verifyReceipt(receiptId: string): Promise<VerifyResponse> {
  const response = await fetch(`${API_BASE}/api/v1/verify/${receiptId}`)
  const body = await response.json()

  if (!response.ok) {
    throw new Error(body.error ?? `verify failed: ${response.status}`)
  }

  return body as VerifyResponse
}

const receiptId = process.argv[2] ?? 'de60f7d6-7cb3-413c-a4cf-d933931ac62b'

try {
  const result = await verifyReceipt(receiptId)
  console.log(`${result.verificationStatus}: ${explain(result.verificationStatus)}`)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
