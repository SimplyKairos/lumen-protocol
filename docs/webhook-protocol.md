# Webhook Protocol

Lumen webhooks deliver receipt issuance events to integrator-controlled HTTP
endpoints. The current implementation supports receipt issuance only.

## Registering a Subscription

Create a subscription with:

```http
POST /api/v1/webhooks
Content-Type: application/json

{
  "targetUrl": "https://example.com/lumen/webhook",
  "eventType": "receipt.issued"
}
```

`eventType` is optional and currently defaults to `receipt.issued`. The response
returns subscription metadata and a one-time signing secret:

```json
{
  "subscription": {
    "subscriptionId": "8c37c386-67ff-4db2-8ff1-7a3799d6874f",
    "targetUrl": "https://example.com/lumen/webhook",
    "eventType": "receipt.issued",
    "active": true,
    "signingSecretMasked": "4f2f07...a91c",
    "createdAt": 1776530306174,
    "updatedAt": 1776530306174
  },
  "signingSecret": "4f2f077b0f5d7b4fce0f0462d64b35a9d4ab46ec80f7b00e05593d579c03a91c"
}
```

Store the signing secret immediately. Later subscription reads expose only the
masked value.

## Event Types

The only supported event type is:

```text
receipt.issued
```

## `receipt.issued` Payload

Each delivery sends JSON with the event envelope and full receipt:

```json
{
  "eventId": "db8f72a2-38de-4dd7-9853-67eeb5f380cc",
  "eventType": "receipt.issued",
  "createdAt": 1776530307000,
  "receipt": {
    "receiptId": "de60f7d6-7cb3-413c-a4cf-d933931ac62b",
    "txSignature": "4rLD5XfdvrmQJfKqVArBsGs7qCwCbhi8z53gkgCzMUAgvzGArTS4UP4qpN5fhM7r9uW19yM8d1Z8mcJwFLhzqcQW",
    "bundleId": "030c9d74fa6adedbab3c8a124e26898de4fe555b6b6d349c47bf8fc0bea3e5cc",
    "slot": 414075157,
    "confirmationStatus": "finalized",
    "receiptHash": "54fc08881bed02c6ff6de298940b0a4e4dde8d40bc802fe2a716e1112e31e2f6",
    "onChainMemo": "3zhKUuydLBtuMEHpBLnoBrTN4s7YAaqS71Mk4qLCPp4nYQvjbS1BJGkAM8E6CJgeY149oET6TGhZQACwoBkDi3Q7",
    "attestationLevel": "BUNDLE_VERIFIED",
    "walletAddress": null,
    "verified": true,
    "createdAt": 1776530306174,
    "schemaVersion": "v2",
    "executionQuality": {
      "score": 40,
      "flags": ["SANDWICH_DETECTED"],
      "flagsBitmap": 64,
      "algoVersion": "eqs-v1"
    }
  }
}
```

## Signature Scheme

Each delivery includes:

```http
X-Lumen-Signature: sha256=<hex>
X-Lumen-Timestamp: <unix-ms>
X-Lumen-Delivery-Id: <uuid>
X-Lumen-Event-Type: receipt.issued
```

The signature is:

```text
HMAC-SHA256(signingSecret, `${timestamp}.${body}`)
```

where `body` is the exact raw request body string.

Verify signatures with a constant-time comparison and reject stale timestamps.
A five-minute replay window is recommended.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyLumenWebhook(
  rawBody: string,
  signatureHeader: string,
  timestampHeader: string,
  signingSecret: string,
  nowMs = Date.now()
) {
  if (!signatureHeader.startsWith('sha256=')) return false

  const timestamp = Number(timestampHeader)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(nowMs - timestamp) > 5 * 60 * 1000) return false

  const expectedHex = createHmac('sha256', signingSecret)
    .update(`${timestampHeader}.${rawBody}`)
    .digest('hex')

  const received = Buffer.from(signatureHeader.slice('sha256='.length), 'hex')
  const expected = Buffer.from(expectedHex, 'hex')

  return received.length === expected.length && timingSafeEqual(received, expected)
}
```

## Delivery Semantics

Delivery is at least one attempt per active subscription when a receipt is
issued. The current implementation does not automatically retry failed
deliveries. Integrators should treat deliveries as at-least-once at the
application layer and make handlers idempotent on `receipt.receiptId` or
`eventId`.

Lumen records every attempted delivery with status `pending`, `delivered`, or
`failed`, response status when available, and an error message when delivery
fails.

Inspect recent delivery history with:

```http
GET /api/v1/webhooks/:subscriptionId/deliveries
```

The response includes the subscription, up to 50 most recent deliveries, and a
`count` field.
