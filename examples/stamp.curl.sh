#!/usr/bin/env sh
set -eu

API_BASE="${API_BASE:-https://api.lumenlayer.tech}"

# txSignature: base58 Solana transaction signature to stamp.
# bundleId: 64-character Jito bundle ID containing txSignature.
# walletAddress: optional base58 wallet address to associate with the receipt.
curl -sS -X POST "$API_BASE/api/v1/stamp" \
  -H "Content-Type: application/json" \
  --data '{
    "txSignature": "4rLD5XfdvrmQJfKqVArBsGs7qCwCbhi8z53gkgCzMUAgvzGArTS4UP4qpN5fhM7r9uW19yM8d1Z8mcJwFLhzqcQW",
    "bundleId": "030c9d74fa6adedbab3c8a124e26898de4fe555b6b6d349c47bf8fc0bea3e5cc",
    "walletAddress": null
  }'
