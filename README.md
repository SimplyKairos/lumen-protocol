# Lumen Protocol

> Open execution fairness protocol for Solana.

Lumen issues cryptographically verifiable execution receipts for Solana transactions. Every receipt is SHA-256 bound to real Jito bundle execution context and anchored permanently on-chain via the Solana memo program. Anyone can independently verify any receipt without trusting Lumen.

## How it works

1. Caller submits a transaction signature and bundle ID to the stamp endpoint
2. Lumen calls `getBundleStatuses` — extracts `bundleId`, `slot`, `confirmationStatus`
3. Computes `SHA-256(txSignature || bundleId || slot)`
4. Writes the digest on-chain as a Solana memo transaction
5. Anyone can recompute the hash and verify it matches the on-chain memo

**Attestation levels**

| Level | Description |
|-------|-------------|
| `BUNDLE_VERIFIED` | Confirmed via Jito bundle execution metadata, anchored on-chain |
| `BAM_ATTESTED` | Full TEE attestation digest bound to receipt (upgrade path ready) |

Current receipts are issued as `BUNDLE_VERIFIED`. Per-bundle BAM TEE attestation digests are not yet publicly accessible via API. The schema is designed for a clean upgrade to `BAM_ATTESTED` when access becomes available — no changes to the core receipt contract required.

---

## Receipt schema

Every receipt follows this canonical shape:

```json
{
  "receiptId": "uuid",
  "txSignature": "string",
  "bundleId": "string",
  "slot": "number",
  "confirmationStatus": "confirmed | finalized",
  "receiptHash": "sha256hex",
  "onChainMemo": "solana_tx_signature | null",
  "attestationLevel": "BUNDLE_VERIFIED | BAM_ATTESTED",
  "walletAddress": "string | null",
  "verified": "boolean",
  "createdAt": "unix_ms"
}
```

Full schema at [`schema/receipt-schema.json`](./schema/receipt-schema.json)

---

## API

Base URL: `https://api.lumenlayer.tech`

### Rate limits

| Endpoint | Limit |
|----------|-------|
| `POST /api/v1/stamp` | 10 requests per minute per IP |
| All other endpoints | No limit |

Returns `429` with `{ "error": "Rate limit exceeded. Maximum 10 stamp requests per minute per IP." }` if exceeded.

---

### Issue a receipt

```http
POST /api/v1/stamp
Content-Type: application/json

{
  "txSignature": "your_solana_tx_signature",
  "bundleId": "your_jito_bundle_id",
  "walletAddress": "optional_wallet_address"
}
```

**Response**
```json
{
  "receiptId": "ba30a96e-0de3-4d64-bff9-faecd1549377",
  "txSignature": "5xNpK...",
  "bundleId": "jito-bundle-...",
  "slot": 324901882,
  "confirmationStatus": "confirmed",
  "receiptHash": "7b3b0308ca82b01041344e5ab1c2556d902e25eda13e824346e2ac2d7b80144e",
  "onChainMemo": "memo_tx_signature",
  "attestationLevel": "BUNDLE_VERIFIED",
  "verified": true,
  "createdAt": 1775479278783
}
```

- Stamping is idempotent on `txSignature` — submitting the same transaction twice returns the existing receipt.
- Stamp requests typically complete in 5–15 seconds while the on-chain memo confirms. Plan for async handling in your integration.

---

### Verify a receipt

```http
GET /api/v1/verify/:receiptId
```

**Response**
```json
{
  "receiptId": "ba30a96e-...",
  "verificationStatus": "VERIFIED",
  "attestationLevel": "BUNDLE_VERIFIED",
  "hashMatches": true,
  "memoMatches": true,
  "verified": true,
  "txSignature": "5xNpK...",
  "bundleId": "jito-bundle-...",
  "slot": 324901882,
  "receiptHash": "7b3b0308...",
  "onChainMemo": "memo_tx_signature",
  "createdAt": 1775479278783
}
```

**Verification status values**

| Status | Meaning |
|--------|---------|
| `VERIFIED` | Hash recomputed, matches on-chain memo — execution context confirmed |
| `ANCHOR_NOT_FOUND` | On-chain memo transaction not found on any RPC |
| `ANCHOR_LOOKUP_FAILED` | Hash exists but on-chain memo lookup failed |
| `MEMO_MISMATCH` | On-chain memo found but data does not match receipt hash |
| `HASH_MISMATCH` | Recomputed hash does not match stored receipt hash |
| `UNANCHORED` | Receipt issued but memo not yet written to chain |

---

### List recent receipts

```http
GET /api/v1/receipts
```

Returns the 50 most recent receipts with `verificationStatus` inline — no additional verification requests needed.

---

### Register a webhook subscription

```http
POST /api/v1/webhooks
Content-Type: application/json

{
  "targetUrl": "https://your-endpoint.com/lumen-webhook",
  "eventType": "receipt.issued"
}
```

**Response**
```json
{
  "subscription": {
    "subscriptionId": "uuid",
    "targetUrl": "https://your-endpoint.com/lumen-webhook",
    "eventType": "receipt.issued",
    "active": true,
    "signingSecretMasked": "lumsec...c3f9",
    "createdAt": 1775479278783,
    "updatedAt": 1775479278783
  },
  "signingSecret": "hmac_secret_for_signature_verification"
}
```

Each delivery is signed with `HMAC-SHA256` using your subscription secret. Verify the `X-Lumen-Signature` header together with `X-Lumen-Timestamp` on every incoming webhook.

---

### Inspect webhook delivery history

```http
GET /api/v1/webhooks/:subscriptionId/deliveries
```

---

## Integrating Lumen into your app

The integration is one API call per stamped transaction. After your transaction lands on-chain, call the stamp endpoint with the transaction signature and Jito bundle ID:

```typescript
async function stampTransaction(txSignature: string, bundleId: string, walletAddress: string) {
  const response = await fetch('https://api.lumenlayer.tech/api/v1/stamp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txSignature, bundleId, walletAddress }),
  })

  const receipt = await response.json()

  // receipt.receiptId — share with the trader
  // receipt.receiptHash — the SHA-256 execution proof
  // receipt.verified — true if anchored and confirmed
  // receipt.attestationLevel — BUNDLE_VERIFIED

  return receipt
}
```

Show the `receiptId` to your users. They can verify it at any time at `https://lumenlayer.tech/verify?receiptId=RECEIPT_ID` or by calling the verify endpoint directly.

---

## Verifiable receipt link

Every receipt has a shareable public URL:

```
https://lumenlayer.tech/verify?receiptId=RECEIPT_ID
```

Users can paste this link into any browser and independently verify execution context without trusting your platform or Lumen.

---

## Webhook payload

When a receipt is issued your subscribed endpoint receives:

```json
{
  "eventId": "evt_123",
  "eventType": "receipt.issued",
  "createdAt": 1775479278783,
  "receipt": {
    "receiptId": "ba30a96e-...",
    "txSignature": "5xNpK...",
    "bundleId": "jito-bundle-...",
    "slot": 324901882,
    "confirmationStatus": "confirmed",
    "receiptHash": "7b3b0308...",
    "onChainMemo": "memo_tx_signature",
    "attestationLevel": "BUNDLE_VERIFIED",
    "walletAddress": "6P8Y...",
    "verified": true,
    "createdAt": 1775479278783
  }
}
```

Verify the signature:

```typescript
import { createHmac } from 'crypto'

function verifyWebhookSignature(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  return `sha256=${expected}` === signature
}
```

---

## Self-hosting

```bash
git clone https://github.com/SimplyKairos/lumen-protocol
cd lumen-protocol
cp .env.example .env
# fill in HELIUS_RPC_MAINNET, BACKEND_KEYPAIR, JITO_BLOCK_ENGINE_URL
npm install
npm run dev
```

The server creates its local SQLite store automatically at `data/lumen.db` on first boot.

---

## Receipt verification — independent replay

Anyone can verify a receipt without calling the Lumen API:

1. Fetch the receipt from `GET /api/v1/verify/:receiptId`
2. Recompute `SHA-256(txSignature || bundleId || slot)` — must match `receiptHash`
3. Fetch the on-chain memo transaction from any Solana RPC
4. Confirm the memo data matches `receiptHash`

If both match the receipt is independently verified. No trust in Lumen required at any step.

---

## License

Apache-2.0 — open for anyone to integrate, fork, or build on.

**Links**
- Site: [lumenlayer.tech](https://lumenlayer.tech)
- Verifier: [lumenlayer.tech/verify](https://lumenlayer.tech/verify)
- Explorer: [lumenlayer.tech/receipts](https://lumenlayer.tech/receipts)
- X: [@LumenLayer](https://x.com/LumenLayer)
