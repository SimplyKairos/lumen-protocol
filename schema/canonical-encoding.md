# Canonical Receipt Encoding

Lumen v2 defines a strict byte-level pre-image for receipt hashing. The
pre-image is intentionally small and reproducible from fields present in the
receipt body.

## Hash Formula

```text
SHA-256(txSignature || bundleId || slot || score || flagsBitmap || algoVersion)
```

For v2 receipts, `||` means a single `0x1f` byte between adjacent fields. The
byte is ASCII Unit Separator. No leading separator, trailing separator, JSON
encoding, escaping, or whitespace normalization is allowed.

Legacy v1 receipts used `SHA-256(txSignature + bundleId + slot)` with raw string
concatenation. v1 is preserved only so old receipts can be verified; all new
Lumen-compliant EQS receipts use the v2 encoding below.

## Encoding Rules

1. Read fields in the exact order listed in [Field Order](#field-order).
2. Convert every field to its UTF-8 byte sequence.
3. Stringify `slot`, `score`, and `flagsBitmap` as base-10 integers with no
   padding, grouping separators, decimal points, or sign prefix.
4. Join the six UTF-8 field byte sequences with exactly one `0x1f` byte between
   adjacent fields.
5. Compute SHA-256 over the resulting byte array.
6. Encode the digest as lowercase hexadecimal.

## Field Order

The v2 pre-image fields are:

1. `txSignature`
2. `bundleId`
3. `slot`
4. `score`
5. `flagsBitmap`
6. `algoVersion`

In the API schema, `score`, `flagsBitmap`, and `algoVersion` are exposed under
`executionQuality`. The hash pre-image uses their scalar values:

```text
receipt.executionQuality.score
receipt.executionQuality.flagsBitmap
receipt.executionQuality.algoVersion
```

## Canonical Flag Bitmap

`flagsBitmap` is the canonical EQS flag representation bound into the v2 hash.
The `flags` array is stored for readability and API convenience, but the bitmap
is the hash input.

The verifier also recomputes the bitmap from `flags` and rejects inconsistent
receipts. If `flags` and `flagsBitmap` disagree, verification returns
`HASH_MISMATCH`.

Bit positions are zero-based and follow alphabetical EQS flag order:

| Bit | Flag |
| ---: | --- |
| 0 | `BACKRUN_SUSPECTED` |
| 1 | `BUNDLE_CONGESTION` |
| 2 | `CLEAN_EXECUTION` |
| 3 | `FEE_INEFFICIENT` |
| 4 | `FRONT_POSITION` |
| 5 | `FRONTRUN_SUSPECTED` |
| 6 | `SANDWICH_DETECTED` |
| 7 | `SLOT_DRIFT_HIGH` |
| 8 | `SOLO_BUNDLE` |
| 9 | `TAIL_POSITION` |

The bitmap is computed with `bitmap |= 1 << bitIndex` for each flag. For
example, `["SANDWICH_DETECTED"]` produces `64`.

## Worked Example

Given the following v2 inputs:

```text
txSignature = 4rLD5XfdvrmQJfKqVArBsGs7qCwCbhi8z53gkgCzMUAgvzGArTS4UP4qpN5fhM7r9uW19yM8d1Z8mcJwFLhzqcQW
bundleId = 030c9d74fa6adedbab3c8a124e26898de4fe555b6b6d349c47bf8fc0bea3e5cc
slot = 414075157
score = 40
flagsBitmap = 64
algoVersion = eqs-v1
```

The canonical UTF-8 pre-image string, shown with escaped separators, is:

```text
4rLD5XfdvrmQJfKqVArBsGs7qCwCbhi8z53gkgCzMUAgvzGArTS4UP4qpN5fhM7r9uW19yM8d1Z8mcJwFLhzqcQW\x1f030c9d74fa6adedbab3c8a124e26898de4fe555b6b6d349c47bf8fc0bea3e5cc\x1f414075157\x1f40\x1f64\x1feqs-v1
```

Its SHA-256 digest is:

```text
54fc08881bed02c6ff6de298940b0a4e4dde8d40bc802fe2a716e1112e31e2f6
```

This Node.js snippet reproduces the hash:

```js
const crypto = require('node:crypto')

const separator = String.fromCharCode(0x1f)
const preimage = [
  '4rLD5XfdvrmQJfKqVArBsGs7qCwCbhi8z53gkgCzMUAgvzGArTS4UP4qpN5fhM7r9uW19yM8d1Z8mcJwFLhzqcQW',
  '030c9d74fa6adedbab3c8a124e26898de4fe555b6b6d349c47bf8fc0bea3e5cc',
  '414075157',
  '40',
  '64',
  'eqs-v1',
].join(separator)

const digest = crypto
  .createHash('sha256')
  .update(preimage, 'utf8')
  .digest('hex')

console.log(digest)
```

Expected output:

```text
54fc08881bed02c6ff6de298940b0a4e4dde8d40bc802fe2a716e1112e31e2f6
```
