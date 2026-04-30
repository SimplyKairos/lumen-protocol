# EQS v1 Specification

EQS v1 is the first Execution Quality Score algorithm for Lumen v2 receipts. It
assigns a bounded 0-100 score, a deterministic flag set, a canonical bitmap,
and the algorithm label `eqs-v1`.

## Algorithm Output

For each stamped transaction, EQS v1 returns:

```ts
type ExecutionQuality = {
  score: number
  flags: Flag[]
  flagsBitmap: number
  algoVersion: 'eqs-v1'
}
```

The `flagsBitmap` field is canonical for receipt hashing. The `flags` array is
included for readability and must be consistent with the bitmap.

## Scoring Formula

EQS v1 starts from 100 and subtracts each flag penalty:

```text
score = clamp(100 - sum(PENALTIES[flag]), 0, 100)
```

`FRONT_POSITION` has a penalty of `-5`, which acts as a small bonus. The final
score is always clamped to the inclusive range `0..100`.

## Score Bands

| Band | Score | Meaning |
| --- | ---: | --- |
| `Clean` | 90-100 | No material fairness harm detected by EQS v1. |
| `Acceptable` | 70-89 | Minor execution quality concerns or mild adverse context. |
| `Degraded` | 40-69 | Meaningful ordering, fee, or congestion harm likely. |
| `Harmful` | 0-39 | Severe extractive pattern, usually sandwich or similar harm. |

## Flag Table

Flags are listed in alphabetical order. Bitmap bits use zero-based positions in
that same order.

| Flag | Bit | Penalty |
| --- | ---: | ---: |
| `BACKRUN_SUSPECTED` | 0 | 15 |
| `BUNDLE_CONGESTION` | 1 | 8 |
| `CLEAN_EXECUTION` | 2 | 0 |
| `FEE_INEFFICIENT` | 3 | 5 |
| `FRONT_POSITION` | 4 | -5 |
| `FRONTRUN_SUSPECTED` | 5 | 30 |
| `SANDWICH_DETECTED` | 6 | 60 |
| `SLOT_DRIFT_HIGH` | 7 | 5 |
| `SOLO_BUNDLE` | 8 | 0 |
| `TAIL_POSITION` | 9 | 10 |

## Detection Rules

EQS v1 evaluates the target transaction against the landed bundle and adjacent
transactions in that bundle.

`SOLO_BUNDLE` is set when the bundle contains only the target transaction.

`BACKRUN_SUSPECTED` is set when the next transaction is from a different signer
and consumes the target transaction's output token.

`FRONTRUN_SUSPECTED` is set when the previous transaction is from a different
signer, trades the same token pair, and has input amount greater than or equal
to the target input amount.

`SANDWICH_DETECTED` is set when the same external signer has one adjacent
transaction before the target and one after the target, and the token flow wraps
around the target token path.

`FRONT_POSITION` is set when the target transaction is at position 0 in a bundle
of at least three transactions.

`TAIL_POSITION` is set when the target transaction lands in one of the last two
positions in a bundle of at least three transactions.

`BUNDLE_CONGESTION` is set when the bundle contains at least five transactions.

`SLOT_DRIFT_HIGH` is set when `landedSlot - submitSlot > 4`.

`FEE_INEFFICIENT` is set only when a network median fee baseline is available
and `priorityFeeLamports + bundleTipLamports > 3 * networkMedianFeeLamports`.

`CLEAN_EXECUTION` is set when no harm flags are present. It can coexist with
informational or favorable flags such as `SOLO_BUNDLE` and `FRONT_POSITION`.

## Penalty Rationales

### `BACKRUN_SUSPECTED` (`15`)

Backrun behavior can indicate that a transaction was used as a pricing anchor or
inventory source for another actor immediately behind it. The harm is meaningful
but usually less directly destructive than a confirmed frontrun or sandwich.

### `BUNDLE_CONGESTION` (`8`)

Bundle congestion reflects crowding around the execution opportunity. It raises
the chance of degraded ordering quality, delayed inclusion, or competitive fee
pressure, but does not by itself prove extraction.

### `CLEAN_EXECUTION` (`0`)

Clean execution is the neutral baseline for trades that do not trigger adverse
routing or ordering patterns tracked by EQS v1.

### `FEE_INEFFICIENT` (`5`)

Fee inefficiency means the trade appears to have paid more priority cost than
was necessary for the achieved execution outcome.

### `FRONT_POSITION` (`-5`)

Front position indicates a favorable place near the head of the bundle. It is a
small bonus and does not overpower adverse signals.

### `FRONTRUN_SUSPECTED` (`30`)

Suspected frontrunning points to another actor entering ahead of the user in a
way that can worsen price, reduce fill quality, or capture informational edge.

### `SANDWICH_DETECTED` (`60`)

Sandwich behavior is treated as the most severe EQS v1 flag because it implies a
coordinated before-and-after pattern that extracts value around the user trade.

### `SLOT_DRIFT_HIGH` (`5`)

High slot drift suggests the execution context moved farther than expected
between observed bundle state and inclusion slot.

### `SOLO_BUNDLE` (`0`)

A solo bundle reduces ambiguity around adjacent ordering pressure but does not
automatically imply advantage or disadvantage.

### `TAIL_POSITION` (`10`)

Tail position exposes the target transaction to more adverse sequencing risk
than a front or middle position.

## Wallet Damage Extraction Heuristic

The Wallet Damage Report uses EQS flags to estimate a conservative lower-bound
extraction amount. This is not a verified extraction figure and should not be
presented as exact loss.

For `SANDWICH_DETECTED` trades:

```ts
estimatedHarmLamports = target.amountIn * 3n / 1000n
```

For `FRONTRUN_SUSPECTED` trades:

```ts
estimatedHarmLamports = target.amountIn / 1000n
```

All other flags produce `0n` estimated harm. Total wallet extraction is the sum
of estimated harm across scored trades, serialized as lamports at the API
boundary and converted to SOL with `lamports / 1_000_000_000`.

## Versioning

Receipts that use this algorithm set `executionQuality.algoVersion` to
`eqs-v1`. Future scoring changes must increment `algoVersion`; schema changes
that affect hash inputs must also increment `schemaVersion`.
