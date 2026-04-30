# Verification Flow

Lumen receipts are designed to be verified without trusting Lumen's reported
`verified` boolean. A verifier needs the receipt body, a Solana RPC endpoint,
and the canonical encoding rules.

## Steps

1. Obtain the receipt. Integrators usually receive it from `POST /api/v1/stamp`
   or a `receipt.issued` webhook. For recent public receipts, `GET
   /api/v1/receipts` can also be used.
2. Recompute `receiptHash` from the canonical v2 pre-image defined in
   [`../schema/canonical-encoding.md`](../schema/canonical-encoding.md).
3. Confirm the recomputed hash equals `receipt.receiptHash`.
4. Fetch the on-chain memo transaction identified by `receipt.onChainMemo`.
5. Decode the Solana memo program instruction data.
6. Confirm the memo data equals `receipt.receiptHash`.

If the hash recomputes and the on-chain memo matches, the receipt is
independently verified.

## Verification Status

| Status | Meaning |
| --- | --- |
| `VERIFIED` | Recomputed hash and on-chain memo both match. |
| `HASH_MISMATCH` | Receipt fields do not recompute to `receipt.receiptHash`. |
| `MEMO_MISMATCH` | Memo transaction exists but memo data does not match `receipt.receiptHash`. |
| `ANCHOR_NOT_FOUND` | `receipt.onChainMemo` does not exist on chain. |
| `ANCHOR_LOOKUP_FAILED` | RPC failed while fetching the memo transaction. |
| `UNANCHORED` | Receipt was issued but `onChainMemo` is null. |

## TypeScript Example

This example verifies a receipt object without calling Lumen's verify endpoint.
It uses `GET /api/v1/receipts` only as a convenient way to fetch a recent
receipt for demonstration.

```ts
import { createHash } from 'node:crypto'

const LUMEN_API = 'https://api.lumenlayer.tech'
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

type VerificationStatus =
  | 'VERIFIED'
  | 'HASH_MISMATCH'
  | 'MEMO_MISMATCH'
  | 'ANCHOR_NOT_FOUND'
  | 'ANCHOR_LOOKUP_FAILED'
  | 'UNANCHORED'

type Receipt = {
  receiptId: string
  txSignature: string
  bundleId: string
  slot: number
  receiptHash: string
  onChainMemo: string | null
  executionQuality: {
    score: number
    flags: string[]
    flagsBitmap: number
    algoVersion: string
  }
}

function computeReceiptHash(receipt: Receipt) {
  const separator = String.fromCharCode(0x1f)
  const preimage = [
    receipt.txSignature,
    receipt.bundleId,
    String(receipt.slot),
    String(receipt.executionQuality.score),
    String(receipt.executionQuality.flagsBitmap),
    receipt.executionQuality.algoVersion,
  ].join(separator)

  return createHash('sha256').update(preimage, 'utf8').digest('hex')
}

function base58Decode(value: string) {
  let bytes = [0]
  for (const char of value) {
    const index = BASE58.indexOf(char)
    if (index === -1) throw new Error(`invalid base58 character: ${char}`)

    let carry = index
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  for (const char of value) {
    if (char !== '1') break
    bytes.push(0)
  }

  return Uint8Array.from(bytes.reverse())
}

async function fetchRecentReceipt(receiptId: string): Promise<Receipt> {
  const response = await fetch(`${LUMEN_API}/api/v1/receipts`)
  if (!response.ok) throw new Error(`receipt fetch failed: ${response.status}`)

  const body = await response.json() as { receipts: Receipt[] }
  const receipt = body.receipts.find(item => item.receiptId === receiptId)
  if (!receipt) throw new Error('receipt not found in recent receipt list')
  return receipt
}

async function fetchMemoText(rpcUrl: string, signature: string) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'lumen-verify',
      method: 'getTransaction',
      params: [
        signature,
        { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
      ],
    }),
  })

  if (!response.ok) throw new Error(`rpc http ${response.status}`)
  const body = await response.json()
  if (body.error) throw new Error(body.error.message)
  if (!body.result) return null

  const message = body.result.transaction.message
  const accountKeys = message.accountKeys.map((key: string | { pubkey: string }) =>
    typeof key === 'string' ? key : key.pubkey
  )

  for (const ix of message.instructions) {
    if (accountKeys[ix.programIdIndex] !== MEMO_PROGRAM_ID) continue
    return new TextDecoder().decode(base58Decode(ix.data))
  }

  return null
}

export async function verifyReceiptIndependently(
  receipt: Receipt,
  rpcUrl: string
): Promise<VerificationStatus> {
  if (computeReceiptHash(receipt) !== receipt.receiptHash) {
    return 'HASH_MISMATCH'
  }

  if (!receipt.onChainMemo) return 'UNANCHORED'

  let memoText: string | null
  try {
    memoText = await fetchMemoText(rpcUrl, receipt.onChainMemo)
  } catch {
    return 'ANCHOR_LOOKUP_FAILED'
  }

  if (memoText === null) return 'ANCHOR_NOT_FOUND'
  return memoText === receipt.receiptHash ? 'VERIFIED' : 'MEMO_MISMATCH'
}

const receiptId = process.argv[2]
const rpcUrl = process.env.SOLANA_RPC_URL
if (!receiptId || !rpcUrl) {
  throw new Error('Usage: SOLANA_RPC_URL=<url> ts-node verification-flow.ts <receiptId>')
}

const receipt = await fetchRecentReceipt(receiptId)
console.log(await verifyReceiptIndependently(receipt, rpcUrl))
```
