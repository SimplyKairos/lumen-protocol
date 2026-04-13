import { v4 as uuidv4 } from 'uuid'
import { db } from './db'
import {
  countLaunchBundlerAlerts,
  listCreatorBundlerAlerts,
  listLaunchBundlerAlerts,
} from './bundler-alert-service'
import {
  mapLaunchToCreatorRecentLaunch,
  mapLaunchRowToLaunch,
  type CreatorProfile,
  type LaunchCreateBody,
  type LaunchRow,
  type LaunchListResponse,
  type LumenLaunch,
} from './launch'
import {
  provisionAlphaVaultLinkage,
  type AlphaVaultServiceDependencies,
} from './alpha-vault-service'
import {
  activateLaunchOnDbc,
  type DbcServiceDependencies,
} from './dbc-service'

const LIST_LAUNCHES_LIMIT = 50
const RECENT_CREATOR_LAUNCHES_LIMIT = 5

type CreatorRow = {
  wallet_address: string
  display_name: string | null
  twitter_handle: string | null
  verified: number | boolean | null
  total_launches: number | null
  successful_launches: number | null
  reputation_score: number | null
}

export interface LaunchServiceDependencies
  extends AlphaVaultServiceDependencies, DbcServiceDependencies {}

export function getProtectedWindowState(
  launch: Pick<LumenLaunch, 'activatedAt' | 'launchWindowSeconds'>,
  options: {
    now?: () => number
  } = {}
) {
  const { now = Date.now } = options
  const protectedWindowEndsAt = launch.activatedAt == null
    ? null
    : launch.activatedAt + launch.launchWindowSeconds * 1000

  return {
    protectedWindowEndsAt,
    protectedWindowActive: protectedWindowEndsAt != null && now() <= protectedWindowEndsAt,
  }
}

function upsertCreator(walletAddress: string, timestamp: number) {
  db.prepare(`
    INSERT INTO creators (
      wallet_address,
      total_launches,
      created_at,
      last_active
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet_address) DO UPDATE SET
      total_launches = total_launches + 1,
      last_active = excluded.last_active
  `).run(walletAddress, 1, timestamp, timestamp)
}

function getLaunchRow(launchId: string) {
  return db.prepare(
    'SELECT * FROM launches WHERE id = ?'
  ).get(launchId) as LaunchRow | undefined
}

function buildLaunchResponse(row: LaunchRow): LumenLaunch {
  const mappedLaunch = mapLaunchRowToLaunch(row)
  const { protectedWindowActive, protectedWindowEndsAt } = getProtectedWindowState(mappedLaunch)
  const recentBundlerAlerts = listLaunchBundlerAlerts(mappedLaunch.launchId)
  const bundlerAlertCount = row.bundler_alerts ?? countLaunchBundlerAlerts(mappedLaunch.launchId)

  return mapLaunchRowToLaunch(row, {
    bundlerAlertCount,
    protectedWindowActive,
    protectedWindowEndsAt,
    recentBundlerAlerts,
  })
}

function refreshCreatorDerivedStats(walletAddress: string) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS launch_count,
      SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) AS successful_launches
    FROM launches
    WHERE creator_wallet = ?
  `).get(walletAddress) as {
    launch_count: number
    successful_launches: number | null
  }

  const launchCount = counts.launch_count ?? 0
  const successfulLaunches = counts.successful_launches ?? 0
  const reputationScore = launchCount === 0
    ? 0
    : Number((successfulLaunches / launchCount).toFixed(2))

  db.prepare(`
    UPDATE creators
    SET total_launches = ?,
        successful_launches = ?,
        reputation_score = ?,
        last_active = ?
    WHERE wallet_address = ?
  `).run(
    launchCount,
    successfulLaunches,
    reputationScore,
    Date.now(),
    walletAddress
  )
}

export async function createLaunch(
  input: LaunchCreateBody,
  deps: LaunchServiceDependencies = {}
): Promise<LumenLaunch> {
  const launchId = uuidv4()
  const createdAt = Date.now()
  const alphaVault = await provisionAlphaVaultLinkage(
    {
      ...input,
      launchId,
    },
    deps
  )

  const row = db.transaction(() => {
    db.prepare(`
      INSERT INTO launches (
        id,
        token_name,
        token_symbol,
        token_mint,
        creator_wallet,
        description,
        image_url,
        liquidity_locked,
        lock_duration_days,
        max_wallet_cap,
        launch_window_seconds,
        status,
        bundler_alerts,
        holder_count,
        alpha_vault_address,
        alpha_vault_mode,
        alpha_vault_activation_at,
        dbc_config_address,
        dbc_pool_address,
        activated_at,
        created_at,
        launched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      launchId,
      input.tokenName,
      input.tokenSymbol,
      null,
      input.creatorWallet,
      input.description ?? null,
      input.imageUrl ?? null,
      input.liquidityLocked ? 1 : 0,
      input.lockDurationDays ?? 0,
      input.maxWalletCap ?? null,
      input.launchWindowSeconds,
      'configured',
      0,
      0,
      alphaVault.alphaVaultAddress,
      alphaVault.alphaVaultMode,
      alphaVault.activationAt,
      null,
      null,
      null,
      createdAt,
      null
    )

    upsertCreator(input.creatorWallet, createdAt)

    return db.prepare(
      'SELECT * FROM launches WHERE id = ?'
    ).get(launchId) as LaunchRow | undefined
  })()

  if (!row) {
    throw new Error('launch_not_persisted')
  }

  return buildLaunchResponse(row)
}

export function listLaunches(): LaunchListResponse {
  const rows = db.prepare(`
    SELECT *
    FROM launches
    ORDER BY created_at DESC
    LIMIT ?
  `).all(LIST_LAUNCHES_LIMIT) as LaunchRow[]

  return {
    launches: rows.map(buildLaunchResponse),
    count: rows.length,
  }
}

export function getLaunchById(launchId: string): LumenLaunch | null {
  const row = getLaunchRow(launchId)

  return row ? buildLaunchResponse(row) : null
}

export async function activateLaunch(
  launchId: string,
  deps: LaunchServiceDependencies = {}
): Promise<LumenLaunch | null> {
  const launch = getLaunchById(launchId)

  if (!launch) {
    return null
  }

  if (launch.status === 'live') {
    return launch
  }

  const dbcActivation = await activateLaunchOnDbc(
    {
      launchId: launch.launchId,
      tokenName: launch.tokenName,
      tokenSymbol: launch.tokenSymbol,
      creatorWallet: launch.creatorWallet,
      launchWindowSeconds: launch.launchWindowSeconds,
      alphaVaultAddress: launch.alphaVaultAddress,
      alphaVaultMode: launch.alphaVaultMode,
    },
    deps
  )

  db.prepare(`
    UPDATE launches
    SET status = ?,
        dbc_config_address = ?,
        dbc_pool_address = ?,
        activated_at = ?,
        launched_at = ?
    WHERE id = ?
  `).run(
    'live',
    dbcActivation.dbcConfigAddress,
    dbcActivation.dbcPoolAddress,
    dbcActivation.activatedAt,
    dbcActivation.activatedAt,
    launchId
  )

  refreshCreatorDerivedStats(launch.creatorWallet)

  return getLaunchById(launchId)
}

export function getCreatorProfile(walletAddress: string): CreatorProfile | null {
  const creator = db.prepare(`
    SELECT *
    FROM creators
    WHERE wallet_address = ?
  `).get(walletAddress) as CreatorRow | undefined

  if (!creator) {
    return null
  }

  refreshCreatorDerivedStats(walletAddress)

  const refreshedCreator = db.prepare(`
    SELECT *
    FROM creators
    WHERE wallet_address = ?
  `).get(walletAddress) as CreatorRow

  const receiptCountRow = db.prepare(`
    SELECT COUNT(*) AS receipt_count
    FROM receipts
    INNER JOIN launches ON launches.id = receipts.launch_id
    WHERE launches.creator_wallet = ?
  `).get(walletAddress) as { receipt_count: number }

  const launchCountRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM launches
    WHERE creator_wallet = ?
  `).get(walletAddress) as { count: number }

  const recentLaunchRows = db.prepare(`
    SELECT *
    FROM launches
    WHERE creator_wallet = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(walletAddress, RECENT_CREATOR_LAUNCHES_LIMIT) as LaunchRow[]

  const recentLaunches = recentLaunchRows
    .map(row => mapLaunchRowToLaunch(row))
    .map(mapLaunchToCreatorRecentLaunch)
  const recentBundlerAlerts = listCreatorBundlerAlerts(walletAddress)
  const bundlerAlertCountRow = db.prepare(`
    SELECT COUNT(*) AS bundler_alert_count
    FROM bundler_alerts
    INNER JOIN launches ON launches.id = bundler_alerts.launch_id
    WHERE launches.creator_wallet = ?
  `).get(walletAddress) as { bundler_alert_count: number }

  return {
    walletAddress,
    displayName: refreshedCreator.display_name,
    twitterHandle: refreshedCreator.twitter_handle,
    verified: Boolean(refreshedCreator.verified),
    launchCount: launchCountRow.count ?? refreshedCreator.total_launches ?? 0,
    receiptCount: receiptCountRow.receipt_count ?? 0,
    successfulLaunches: refreshedCreator.successful_launches ?? 0,
    reputationScore: refreshedCreator.reputation_score ?? 0,
    bundlerAlertCount: bundlerAlertCountRow.bundler_alert_count ?? 0,
    recentBundlerAlerts,
    recentLaunches,
  }
}
