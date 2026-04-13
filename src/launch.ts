import { receiptSchema, type LumenReceipt } from './receipt'

export const alphaVaultModes = ['FCFS', 'PRORATA'] as const
export type AlphaVaultMode = (typeof alphaVaultModes)[number]

export const launchStatuses = ['pending', 'configured', 'live'] as const
export type LaunchStatus = (typeof launchStatuses)[number]
export const launchTradeSides = ['buy', 'sell'] as const
export type LaunchTradeSide = (typeof launchTradeSides)[number]

export interface LaunchCreateBody {
  tokenName: string
  tokenSymbol: string
  creatorWallet: string
  launchWindowSeconds: number
  alphaVaultMode: AlphaVaultMode
  description?: string | null
  imageUrl?: string | null
  maxWalletCap?: number | null
  liquidityLocked?: boolean
  lockDurationDays?: number | null
}

export interface LumenLaunch {
  launchId: string
  tokenName: string
  tokenSymbol: string
  tokenMint: string | null
  creatorWallet: string
  description: string | null
  imageUrl: string | null
  liquidityLocked: boolean
  lockDurationDays: number
  maxWalletCap: number | null
  launchWindowSeconds: number
  status: LaunchStatus
  alphaVaultMode: AlphaVaultMode
  alphaVaultAddress: string | null
  alphaVaultActivationAt: number | null
  dbcConfigAddress: string | null
  dbcPoolAddress: string | null
  activatedAt: number | null
  bundlerAlertCount: number
  protectedWindowActive: boolean
  protectedWindowEndsAt: number | null
  recentBundlerAlerts: LaunchBundlerAlert[]
  createdAt: number
  launchedAt: number | null
}

export interface LaunchListResponse {
  launches: LumenLaunch[]
  count: number
}

export interface LaunchTradeBody {
  txSignature: string
  bundleId: string
  walletAddress?: string | null
  side: LaunchTradeSide
  amountIn: number
  minAmountOut: number
}

export interface LaunchTrade {
  side: LaunchTradeSide
  amountIn: number
  minAmountOut: number
  walletAddress: string | null
  executedAt: number
}

export interface LaunchTradeResponse {
  launch: LumenLaunch
  receipt: LumenReceipt
  trade: LaunchTrade
}

export interface CreatorRecentLaunch {
  launchId: string
  tokenName: string
  status: LaunchStatus
  createdAt: number
  launchWindowSeconds: number
}

export interface CreatorProfile {
  walletAddress: string
  displayName: string | null
  twitterHandle: string | null
  verified: boolean
  launchCount: number
  receiptCount: number
  successfulLaunches: number
  reputationScore: number
  bundlerAlertCount: number
  recentBundlerAlerts: CreatorRecentBundlerAlert[]
  recentLaunches: CreatorRecentLaunch[]
}

export interface LaunchBundlerAlert {
  alertId: string
  alertType: string
  bundleId: string
  slot: number
  walletAddress: string
  txSignature: string
  receiptId: string
  participantCount: number
  createdAt: number
}

export interface CreatorRecentBundlerAlert {
  alertId: string
  launchId: string
  tokenName: string
  alertType: string
  bundleId: string
  slot: number
  txSignature: string
  createdAt: number
}

export interface LaunchRow {
  id: string
  token_name: string
  token_symbol: string
  token_mint: string | null
  creator_wallet: string
  description: string | null
  image_url: string | null
  liquidity_locked: number | boolean | null
  lock_duration_days: number | null
  max_wallet_cap: number | null
  launch_window_seconds: number
  status: string
  bundler_alerts: number
  holder_count: number
  alpha_vault_address: string | null
  alpha_vault_mode: AlphaVaultMode | null
  alpha_vault_activation_at: number | null
  dbc_config_address: string | null
  dbc_pool_address: string | null
  activated_at: number | null
  created_at: number
  launched_at: number | null
}

const nullableStringSchema = { type: ['string', 'null'] } as const
const nullableIntegerSchema = { type: ['integer', 'null'] } as const
const nullableNumberSchema = { type: ['number', 'null'] } as const

export const launchCreateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'tokenName',
    'tokenSymbol',
    'creatorWallet',
    'launchWindowSeconds',
    'alphaVaultMode',
  ],
  properties: {
    tokenName: { type: 'string', minLength: 1 },
    tokenSymbol: { type: 'string', minLength: 1 },
    creatorWallet: { type: 'string', minLength: 1 },
    launchWindowSeconds: { type: 'integer', minimum: 1 },
    alphaVaultMode: { type: 'string', enum: [...alphaVaultModes] },
    description: nullableStringSchema,
    imageUrl: nullableStringSchema,
    maxWalletCap: nullableNumberSchema,
    liquidityLocked: { type: 'boolean' },
    lockDurationDays: nullableIntegerSchema,
  },
} as const

export const launchParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['launchId'],
  properties: {
    launchId: { type: 'string', minLength: 1 },
  },
} as const

export const creatorWalletParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['walletAddress'],
  properties: {
    walletAddress: { type: 'string', minLength: 1 },
  },
} as const

export const launchSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'launchId',
    'tokenName',
    'tokenSymbol',
    'tokenMint',
    'creatorWallet',
    'description',
    'imageUrl',
    'liquidityLocked',
    'lockDurationDays',
    'maxWalletCap',
    'launchWindowSeconds',
    'status',
    'alphaVaultMode',
    'alphaVaultAddress',
    'alphaVaultActivationAt',
    'dbcConfigAddress',
    'dbcPoolAddress',
    'activatedAt',
    'bundlerAlertCount',
    'protectedWindowActive',
    'protectedWindowEndsAt',
    'recentBundlerAlerts',
    'createdAt',
    'launchedAt',
  ],
  properties: {
    launchId: { type: 'string', minLength: 1 },
    tokenName: { type: 'string', minLength: 1 },
    tokenSymbol: { type: 'string', minLength: 1 },
    tokenMint: nullableStringSchema,
    creatorWallet: { type: 'string', minLength: 1 },
    description: nullableStringSchema,
    imageUrl: nullableStringSchema,
    liquidityLocked: { type: 'boolean' },
    lockDurationDays: { type: 'integer' },
    maxWalletCap: nullableNumberSchema,
    launchWindowSeconds: { type: 'integer' },
    status: { type: 'string', enum: [...launchStatuses] },
    alphaVaultMode: { type: 'string', enum: [...alphaVaultModes] },
    alphaVaultAddress: nullableStringSchema,
    alphaVaultActivationAt: nullableIntegerSchema,
    dbcConfigAddress: nullableStringSchema,
    dbcPoolAddress: nullableStringSchema,
    activatedAt: nullableIntegerSchema,
    bundlerAlertCount: { type: 'integer' },
    protectedWindowActive: { type: 'boolean' },
    protectedWindowEndsAt: nullableIntegerSchema,
    recentBundlerAlerts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'alertId',
          'alertType',
          'bundleId',
          'slot',
          'walletAddress',
          'txSignature',
          'receiptId',
          'participantCount',
          'createdAt',
        ],
        properties: {
          alertId: { type: 'string', minLength: 1 },
          alertType: { type: 'string', minLength: 1 },
          bundleId: { type: 'string', minLength: 1 },
          slot: { type: 'integer' },
          walletAddress: { type: 'string', minLength: 1 },
          txSignature: { type: 'string', minLength: 1 },
          receiptId: { type: 'string', minLength: 1 },
          participantCount: { type: 'integer' },
          createdAt: { type: 'integer' },
        },
      },
    },
    createdAt: { type: 'integer' },
    launchedAt: nullableIntegerSchema,
  },
} as const

export const launchListSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['launches', 'count'],
  properties: {
    launches: {
      type: 'array',
      items: launchSchema,
    },
    count: { type: 'integer' },
  },
} as const

export const launchTradeBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['txSignature', 'bundleId', 'side', 'amountIn', 'minAmountOut'],
  properties: {
    txSignature: { type: 'string', minLength: 1 },
    bundleId: { type: 'string', minLength: 1 },
    walletAddress: nullableStringSchema,
    side: { type: 'string', enum: [...launchTradeSides] },
    amountIn: { type: 'number', exclusiveMinimum: 0 },
    minAmountOut: { type: 'number', minimum: 0 },
  },
} as const

export const launchTradeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['side', 'amountIn', 'minAmountOut', 'walletAddress', 'executedAt'],
  properties: {
    side: { type: 'string', enum: [...launchTradeSides] },
    amountIn: { type: 'number' },
    minAmountOut: { type: 'number' },
    walletAddress: nullableStringSchema,
    executedAt: { type: 'integer' },
  },
} as const

export const launchTradeResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['launch', 'receipt', 'trade'],
  properties: {
    launch: launchSchema,
    receipt: receiptSchema,
    trade: launchTradeSchema,
  },
} as const

export const creatorRecentLaunchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['launchId', 'tokenName', 'status', 'createdAt', 'launchWindowSeconds'],
  properties: {
    launchId: { type: 'string', minLength: 1 },
    tokenName: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: [...launchStatuses] },
    createdAt: { type: 'integer' },
    launchWindowSeconds: { type: 'integer' },
  },
} as const

export const creatorProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'walletAddress',
    'displayName',
    'twitterHandle',
    'verified',
    'launchCount',
    'receiptCount',
    'successfulLaunches',
    'reputationScore',
    'bundlerAlertCount',
    'recentBundlerAlerts',
    'recentLaunches',
  ],
  properties: {
    walletAddress: { type: 'string', minLength: 1 },
    displayName: nullableStringSchema,
    twitterHandle: nullableStringSchema,
    verified: { type: 'boolean' },
    launchCount: { type: 'integer' },
    receiptCount: { type: 'integer' },
    successfulLaunches: { type: 'integer' },
    reputationScore: { type: 'number' },
    bundlerAlertCount: { type: 'integer' },
    recentBundlerAlerts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'alertId',
          'launchId',
          'tokenName',
          'alertType',
          'bundleId',
          'slot',
          'txSignature',
          'createdAt',
        ],
        properties: {
          alertId: { type: 'string', minLength: 1 },
          launchId: { type: 'string', minLength: 1 },
          tokenName: { type: 'string', minLength: 1 },
          alertType: { type: 'string', minLength: 1 },
          bundleId: { type: 'string', minLength: 1 },
          slot: { type: 'integer' },
          txSignature: { type: 'string', minLength: 1 },
          createdAt: { type: 'integer' },
        },
      },
    },
    recentLaunches: {
      type: 'array',
      items: creatorRecentLaunchSchema,
    },
  },
} as const

export function mapLaunchRowToLaunch(
  row: LaunchRow,
  extras: {
    bundlerAlertCount?: number
    protectedWindowActive?: boolean
    protectedWindowEndsAt?: number | null
    recentBundlerAlerts?: LaunchBundlerAlert[]
  } = {}
): LumenLaunch {
  const normalizedStatus = row.status === 'active' ? 'live' : row.status
  const protectedWindowEndsAt = extras.protectedWindowEndsAt ??
    (row.activated_at == null ? null : row.activated_at + row.launch_window_seconds * 1000)
  const protectedWindowActive = extras.protectedWindowActive ??
    (protectedWindowEndsAt != null && Date.now() <= protectedWindowEndsAt)

  return {
    launchId: row.id,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
    tokenMint: row.token_mint,
    creatorWallet: row.creator_wallet,
    description: row.description,
    imageUrl: row.image_url,
    liquidityLocked: Boolean(row.liquidity_locked),
    lockDurationDays: row.lock_duration_days ?? 0,
    maxWalletCap: row.max_wallet_cap,
    launchWindowSeconds: row.launch_window_seconds,
    status: (normalizedStatus as LaunchStatus) ?? 'configured',
    alphaVaultMode: row.alpha_vault_mode ?? 'FCFS',
    alphaVaultAddress: row.alpha_vault_address,
    alphaVaultActivationAt: row.alpha_vault_activation_at,
    dbcConfigAddress: row.dbc_config_address,
    dbcPoolAddress: row.dbc_pool_address,
    activatedAt: row.activated_at,
    bundlerAlertCount: extras.bundlerAlertCount ?? row.bundler_alerts ?? 0,
    protectedWindowActive,
    protectedWindowEndsAt,
    recentBundlerAlerts: extras.recentBundlerAlerts ?? [],
    createdAt: row.created_at,
    launchedAt: row.launched_at,
  }
}

export function mapLaunchToCreatorRecentLaunch(
  launch: LumenLaunch
): CreatorRecentLaunch {
  return {
    launchId: launch.launchId,
    tokenName: launch.tokenName,
    status: launch.status,
    createdAt: launch.createdAt,
    launchWindowSeconds: launch.launchWindowSeconds,
  }
}
