# Attestation Levels

Lumen receipts include an `attestationLevel` field so integrators can reason
about the strength of the execution evidence behind a receipt without changing
the rest of their verification flow.

## `BUNDLE_VERIFIED`

`BUNDLE_VERIFIED` is the current default for all receipts issued by
`api.lumenlayer.tech`.

At this tier, Lumen verifies the transaction against Jito bundle execution
metadata. The issuer checks the submitted `bundleId` with Jito's
`getBundleStatuses` flow and confirms that the stamped `txSignature` appears in
the landed bundle. The receipt binds the transaction signature, bundle ID,
landed slot, confirmation status, EQS output, and algorithm version into the
receipt hash. That hash is then anchored on-chain through the Solana memo
program.

This provides cryptographic evidence of the receipt contents and on-chain
evidence that the digest existed at anchor time. It also provides bundle-level
evidence of inclusion and ordering from Jito's block engine. It is the strongest
tier currently available in the public Lumen implementation.

## `BAM_ATTESTED`

`BAM_ATTESTED` is reserved.

The intent is to use Jito BAM TEE attestation digests when Jito exposes
per-bundle digests publicly. Those digests are not currently available through a
public per-bundle API, so Lumen-compliant issuers must not claim
`BAM_ATTESTED` unless they can include and verify the relevant TEE digest.

The schema field is reserved now so integrators do not need to change enum
handling later. When this tier ships, receipts at `BAM_ATTESTED` will include
the TEE digest in the hash pre-image. That will be a schema and pre-image
upgrade together, expected as `schemaVersion: "v3"`.

Current receipts at `api.lumenlayer.tech` are `BUNDLE_VERIFIED`.
