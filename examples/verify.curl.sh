#!/usr/bin/env sh
set -eu

API_BASE="${API_BASE:-https://api.lumenlayer.tech}"
RECEIPT_ID="${1:-de60f7d6-7cb3-413c-a4cf-d933931ac62b}"

# The response contains the receipt fields plus verificationStatus,
# hashMatches, memoMatches, and verifiedAt when served by the v2 API.
curl -sS "$API_BASE/api/v1/verify/$RECEIPT_ID"
