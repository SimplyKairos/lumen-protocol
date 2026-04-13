import crypto from 'crypto'
import { PublicKey } from '@solana/web3.js'
import type {
  AlphaVaultMode,
  LaunchTrade,
  LaunchTradeBody,
} from './launch'

export interface ActivateLaunchOnDbcInput {
  launchId: string
  tokenName: string
  tokenSymbol: string
  creatorWallet: string
  launchWindowSeconds: number
  alphaVaultAddress: string | null
  alphaVaultMode: AlphaVaultMode
}

export interface DbcActivationResult {
  dbcConfigAddress: string
  dbcPoolAddress: string
  activatedAt: number
}

export interface ExecuteLaunchTradeInput extends LaunchTradeBody {
  launchId: string
}

export interface DbcServiceDependencies {
  activateLaunchOnDbc?: (input: ActivateLaunchOnDbcInput) => Promise<DbcActivationResult>
  executeLaunchTrade?: (input: ExecuteLaunchTradeInput) => Promise<LaunchTrade>
}

function deriveAddress(parts: string[]) {
  const digest = crypto
    .createHash('sha256')
    .update(parts.join(':'))
    .digest()

  return new PublicKey(digest).toBase58()
}

async function defaultActivateLaunchOnDbc(
  input: ActivateLaunchOnDbcInput
): Promise<DbcActivationResult> {
  const activatedAt = Date.now()

  // Real Meteora DBC activation belongs here once signer and config
  // management are wired for live devnet orchestration.
  return {
    dbcConfigAddress: deriveAddress([
      'dbc-config',
      input.launchId,
      input.creatorWallet,
      input.tokenSymbol,
    ]),
    dbcPoolAddress: deriveAddress([
      'dbc-pool',
      input.launchId,
      input.creatorWallet,
      input.tokenSymbol,
      input.alphaVaultMode,
    ]),
    activatedAt,
  }
}

async function defaultExecuteLaunchTrade(
  input: ExecuteLaunchTradeInput
): Promise<LaunchTrade> {
  // Real DBC trade execution will live here once the launchpad owns the full
  // wallet-sign + submission path. For the current backend slice we normalize
  // the trade request through one seam and let the canonical receipt path prove
  // execution truth from the submitted tx signature and bundle context.
  return {
    side: input.side,
    amountIn: input.amountIn,
    minAmountOut: input.minAmountOut,
    walletAddress: input.walletAddress ?? null,
    executedAt: Date.now(),
  }
}

export async function activateLaunchOnDbc(
  input: ActivateLaunchOnDbcInput,
  deps: DbcServiceDependencies = {}
): Promise<DbcActivationResult> {
  const activate = deps.activateLaunchOnDbc ?? defaultActivateLaunchOnDbc
  return activate(input)
}

export async function executeLaunchTrade(
  input: ExecuteLaunchTradeInput,
  deps: DbcServiceDependencies = {}
): Promise<LaunchTrade> {
  const execute = deps.executeLaunchTrade ?? defaultExecuteLaunchTrade
  return execute(input)
}
