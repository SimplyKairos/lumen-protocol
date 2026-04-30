# Lumen Protocol

> Open execution fairness standard for Solana.

## What this is

Lumen is an open standard for cryptographically verifiable execution receipts on
Solana. Receipts bind every transaction to its Jito bundle execution context,
score execution quality with a deterministic algorithm, hash the result, and
anchor the digest on-chain via the Solana memo program. Anyone can recompute the
hash and verify the receipt independently.

This repo is the protocol specification: schema, hash pre-image definition, EQS
scoring algorithm, attestation tiers, webhook contract, and integration
examples. The reference implementation runs at `api.lumenlayer.tech`. You can
call it directly, which is the recommended path, or implement your own
Lumen-compliant issuer using only what is in this repo.

## Quick start

This command stamps a known public transaction and bundle. Stamp requests are
idempotent on `txSignature`, so rerunning the command returns the existing
receipt for that transaction.

```sh
curl -sS -X POST https://api.lumenlayer.tech/api/v1/stamp \
  -H "Content-Type: application/json" \
  --data '{
    "txSignature": "4rLD5XfdvrmQJfKqVArBsGs7qCwCbhi8z53gkgCzMUAgvzGArTS4UP4qpN5fhM7r9uW19yM8d1Z8mcJwFLhzqcQW",
    "bundleId": "030c9d74fa6adedbab3c8a124e26898de4fe555b6b6d349c47bf8fc0bea3e5cc",
    "walletAddress": null
  }'
```

A canonical v2 receipt has this shape:

```json
{
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
```

For a real integration, replace both identifiers with the transaction signature
and Jito bundle ID from your own execution path. The stamp endpoint verifies
that the transaction is present in the submitted bundle before issuing a
receipt. If the bundle cannot be checked yet, the API returns a retryable error
rather than issuing a weak receipt.

## Receipt schema

The formal schema is
[`schema/receipt-schema.json`](schema/receipt-schema.json). The v2 API shape
uses an `executionQuality` object because that is the field layout exposed by
the production schema package.

```jsonc
{
  "receiptId": "de60f7d6-7cb3-413c-a4cf-d933931ac62b", // UUID receipt identifier.
  "txSignature": "4rLD5XfdvrmQJfKqVArBsGs7qCwCbhi8z53gkgCzMUAgvzGArTS4UP4qpN5fhM7r9uW19yM8d1Z8mcJwFLhzqcQW", // Solana transaction signature.
  "bundleId": "030c9d74fa6adedbab3c8a124e26898de4fe555b6b6d349c47bf8fc0bea3e5cc", // Jito bundle ID.
  "slot": 414075157, // Landed bundle slot.
  "confirmationStatus": "finalized", // "confirmed" or "finalized".
  "receiptHash": "54fc08881bed02c6ff6de298940b0a4e4dde8d40bc802fe2a716e1112e31e2f6", // Canonical SHA-256 digest.
  "onChainMemo": "3zhKUuydLBtuMEHpBLnoBrTN4s7YAaqS71Mk4qLCPp4nYQvjbS1BJGkAM8E6CJgeY149oET6TGhZQACwoBkDi3Q7", // Memo anchor transaction signature, or null.
  "attestationLevel": "BUNDLE_VERIFIED", // "BUNDLE_VERIFIED" or reserved "BAM_ATTESTED".
  "walletAddress": null, // Optional wallet address supplied by the integrator.
  "verified": true, // Issuer-side anchor marker.
  "createdAt": 1776530306174, // Unix timestamp in milliseconds.
  "schemaVersion": "v2", // Current receipt schema.
  "executionQuality": {
    "score": 40, // EQS score from 0 to 100.
    "flags": ["SANDWICH_DETECTED"], // Human-readable EQS flags.
    "flagsBitmap": 64, // Canonical bitmap bound into receiptHash.
    "algoVersion": "eqs-v1" // EQS algorithm version.
  }
}
```

`receiptHash` is the integrity boundary. Fields such as `verified` and
`verificationStatus` are operational conveniences returned by the reference API,
but independent verifiers should recompute the hash and inspect the memo anchor
directly. `executionQuality.flagsBitmap` is the flag value bound into the hash;
`executionQuality.flags` is present so humans and clients do not need to decode
the bitmap for ordinary UI work.

## How receipts are computed

The v2 receipt hash is computed from exactly six scalar fields:

```text
SHA-256(txSignature || bundleId || slot || score || flagsBitmap || algoVersion)
```

For v2, `||` means a single byte separator: `0x1f`, ASCII Unit Separator. There
is no leading separator, trailing separator, JSON serialization, or whitespace
normalization. `slot`, `score`, and `flagsBitmap` are stringified as base-10
integers with no padding.

This makes the hash reproducible from any implementation in any language. If a
client has the receipt body, it can rebuild the exact byte pre-image, compute
SHA-256, and compare the result to `receipt.receiptHash`.

The separator matters. Without a separator, different field boundaries can
produce the same concatenated string. The `0x1f` convention avoids boundary
ambiguity while keeping the pre-image compact and easy to implement in clients,
indexers, databases, and audit scripts.

The `flags` array is not directly included in the hash. Instead, EQS flags are
mapped into `flagsBitmap` using the alphabetical bit order defined in the EQS
spec. During verification, the bitmap is used to recompute the hash and the
array is checked against the bitmap for consistency. A mismatch in either value
is treated as `HASH_MISMATCH`.

The byte-level rules are specified in
[`schema/canonical-encoding.md`](schema/canonical-encoding.md).

## Execution Quality Score (EQS v1)

EQS v1 assigns each receipt a 0-100 execution quality score and a deterministic
set of flags. There are 10 flags in alphabetical bitmap order:
`BACKRUN_SUSPECTED`, `BUNDLE_CONGESTION`, `CLEAN_EXECUTION`,
`FEE_INEFFICIENT`, `FRONT_POSITION`, `FRONTRUN_SUSPECTED`,
`SANDWICH_DETECTED`, `SLOT_DRIFT_HIGH`, `SOLO_BUNDLE`, and `TAIL_POSITION`.

The score starts at 100 and subtracts each flag penalty, clamped to `0..100`.
The bands are:

| Band | Score |
| --- | ---: |
| Clean | 90-100 |
| Acceptable | 70-89 |
| Degraded | 40-69 |
| Harmful | 0-39 |

`executionQuality.algoVersion` is currently `eqs-v1`. Future scoring algorithm
updates will increment `algoVersion` and may include `schemaVersion` bumps when
hash inputs change.

EQS v1 is intentionally conservative. It uses observable bundle structure,
relative position, adjacent transaction flow, slot drift, and fee context. It is
not a claim that every harmful trade has been fully quantified. It is a
deterministic receipt field that lets wallets, venues, and auditors compare
execution quality without trusting private scoring state.

Full algorithm details are in [`docs/eqs-v1-spec.md`](docs/eqs-v1-spec.md).

## Integration patterns

### For wallet developers

Use case: display a Lumen score next to every Solana trade in your wallet UI.
Call `GET /api/v1/verify/:receiptId` for any `receiptId` your platform produces
or receives, then display `verificationStatus` and `executionQuality.score`.
For low-friction UX, treat `VERIFIED` as the green path, surface `UNANCHORED` as
pending, and reserve warnings for `HASH_MISMATCH`, `MEMO_MISMATCH`,
`ANCHOR_NOT_FOUND`, and `ANCHOR_LOOKUP_FAILED`.

Code example: [`examples/verify.typescript.ts`](examples/verify.typescript.ts)

### For DEX / aggregator developers

Use case: stamp every trade your platform processes. POST the transaction
signature and bundle ID to `POST /api/v1/stamp`; receive a verifiable receipt.
Show users their `receiptId` so they can verify independently.
The endpoint is idempotent on `txSignature`, which makes it safe to call from
job workers or retry queues. Store the returned `receiptId`, `receiptHash`, and
`onChainMemo` with your trade record.

Code example: [`examples/stamp.typescript.ts`](examples/stamp.typescript.ts)

### For auditors / researchers

Use case: independently verify receipts without trusting Lumen. Recompute the
hash, fetch the on-chain memo transaction, decode the memo instruction, and
confirm they match.
For large-scale analysis, cache Solana RPC lookups by `onChainMemo` and treat
`receiptId` as an application identifier, not as a cryptographic primitive. The
cryptographic binding is `receiptHash`.

Code example: [`docs/verification-flow.md`](docs/verification-flow.md)

## API reference

Base URL:

```text
https://api.lumenlayer.tech
```

`POST /api/v1/stamp`

Issue a receipt. Body: `{ txSignature, bundleId, walletAddress? }`. Response:
full receipt object. Stamping is idempotent on `txSignature`. Documented stamp
errors are `bundle_status_unavailable`, `tx_signature_not_in_bundle`,
`anchor_signer_unavailable`, and `memo_anchor_failed`; retry behavior is exposed
as `retryable`.

Successful responses are `201` for newly issued receipts and `200` when an
existing receipt is returned. The stamp route is rate-limited by the reference
implementation.

`GET /api/v1/verify/:receiptId`

Recompute the hash, check the on-chain anchor, and return verification status.
Response: receipt fields plus `verificationStatus`, `hashMatches`, and
`memoMatches`. See [`docs/verification-flow.md`](docs/verification-flow.md).

The verification status enum is `VERIFIED`, `HASH_MISMATCH`, `MEMO_MISMATCH`,
`ANCHOR_NOT_FOUND`, `ANCHOR_LOOKUP_FAILED`, and `UNANCHORED`.

`GET /api/v1/receipts`

List the 50 most recent receipts. Each row includes `verificationStatus` inline.
This endpoint is intended for explorers, demos, and lightweight monitoring. For
durable application workflows, store the `receiptId` returned by `stamp` or
delivered through webhooks.

`POST /api/v1/webhooks`

Register a webhook subscription. Body: `{ targetUrl, eventType? }`. Returns
subscription metadata and a signing secret. See
[`docs/webhook-protocol.md`](docs/webhook-protocol.md).
The only supported event type today is `receipt.issued`.

## Attestation levels

`BUNDLE_VERIFIED` is the current receipt tier. It means Lumen confirmed the
transaction against Jito bundle status metadata and anchored the receipt hash
through the Solana memo program.

`BAM_ATTESTED` is reserved for a future upgrade using Jito BAM TEE attestation
digests when per-bundle digests are publicly exposed. Current receipts at
`api.lumenlayer.tech` are `BUNDLE_VERIFIED`.

Details are in [`docs/attestation-levels.md`](docs/attestation-levels.md).

Integrators should code enum handling defensively. Unknown future attestation
levels should not be treated as invalid receipts by default; they should be
displayed as unrecognized until the integrator updates policy.

## Webhook delivery

Lumen can deliver `receipt.issued` events to integrator webhooks. Deliveries are
signed with HMAC-SHA256 over `${timestamp}.${body}` and include
`X-Lumen-Signature` plus `X-Lumen-Timestamp` headers. Receivers should verify
with a constant-time comparison, reject timestamps outside a five-minute replay
window, and process receipts idempotently by `receiptId`.

The current implementation records delivery attempts and exposes recent history
through `GET /api/v1/webhooks/:subscriptionId/deliveries`. It does not provide
automatic retry scheduling for failed deliveries, so receivers should be simple,
fast, and durable.

Full payload and verification details are in
[`docs/webhook-protocol.md`](docs/webhook-protocol.md).

## Self-hosting

This repo describes the protocol; it does not include a running server. The
reference implementation lives at `api.lumenlayer.tech`. To run your own
Lumen-compliant issuer, implement the schema and verification flow in this repo
against your own infrastructure: Solana RPC, Jito bundle status, Solana memo
anchoring, and SQLite or equivalent storage. The v1 reference implementation
that previously lived in this repo is preserved in git history at the
pre-spec-rewrite commit.

## Roadmap

- `BAM_ATTESTED` upgrade when Jito exposes per-bundle TEE attestation digests
- Solana Blinks integration for embedded receipt sharing
- World ID sybil resistance for wallet damage scoring

## License

Apache-2.0. Open for anyone to integrate, fork, or build on.

## Links

- Site: https://lumenlayer.tech
- Verifier: https://lumenlayer.tech/verify
- Receipt explorer: https://lumenlayer.tech/receipts
- X: @LumenLayer
- Contact: contact@lumenlayer.tech
