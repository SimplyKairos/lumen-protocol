import crypto from 'crypto'
import { PublicKey } from '@solana/web3.js'
import type { AlphaVaultMode, LaunchCreateBody } from './launch'

export interface AlphaVaultLinkage {
  alphaVaultAddress: string
  alphaVaultMode: AlphaVaultMode
  activationAt: number
}

export interface ProvisionAlphaVaultInput extends LaunchCreateBody {
  launchId: string
}

export interface AlphaVaultServiceDependencies {
  provisionAlphaVault?: (input: ProvisionAlphaVaultInput) => Promise<AlphaVaultLinkage>
}

function deriveDevelopmentVaultAddress(input: ProvisionAlphaVaultInput) {
  const digest = crypto
    .createHash('sha256')
    .update(
      [
        input.launchId,
        input.creatorWallet,
        input.tokenSymbol,
        input.alphaVaultMode,
      ].join(':')
    )
    .digest()

  return new PublicKey(digest).toBase58()
}

async function defaultProvisionAlphaVault(
  input: ProvisionAlphaVaultInput
): Promise<AlphaVaultLinkage> {
  // Real Meteora Alpha Vault transaction wiring belongs here once the
  // launch authority and config flow are finalized. For the pre-live `5a`
  // slice we persist a deterministic launch-scoped linkage that the next
  // lifecycle steps can build on consistently.
  return {
    alphaVaultAddress: deriveDevelopmentVaultAddress(input),
    alphaVaultMode: input.alphaVaultMode,
    activationAt: Date.now() + input.launchWindowSeconds * 1000,
  }
}

export async function provisionAlphaVaultLinkage(
  input: ProvisionAlphaVaultInput,
  deps: AlphaVaultServiceDependencies = {}
): Promise<AlphaVaultLinkage> {
  const provisionAlphaVault = deps.provisionAlphaVault ?? defaultProvisionAlphaVault
  return provisionAlphaVault(input)
}
