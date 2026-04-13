import { db } from './db'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreatorRecentBundlerAlert,
  LaunchBundlerAlert,
  LaunchTrade,
  LumenLaunch,
} from './launch'
import type { LumenReceipt } from './receipt'

const DEFAULT_ALERT_LIMIT = 5

export const SAME_BUNDLE_CLUSTER_ALERT_TYPE = 'same_bundle_cluster'

type BundlerAlertRow = {
  id: string
  launch_id: string
  wallet_address: string
  bundle_id: string | null
  slot: number | null
  alert_type: string | null
  tx_signature: string | null
  receipt_id: string | null
  participant_count: number | null
  created_at: number
  token_name?: string | null
}

export interface RecordBundlerAlertInput {
  launch: Pick<LumenLaunch, 'launchId' | 'activatedAt' | 'launchWindowSeconds' | 'status'>
  receipt: LumenReceipt
  trade: LaunchTrade
}

function syncLaunchBundlerAlertCount(launchId: string) {
  const nextCount = countLaunchBundlerAlerts(launchId)

  db.prepare(`
    UPDATE launches
    SET bundler_alerts = ?
    WHERE id = ?
  `).run(nextCount, launchId)

  return nextCount
}

function mapBundlerAlertRowToLaunchAlert(row: BundlerAlertRow): LaunchBundlerAlert {
  return {
    alertId: row.id,
    alertType: row.alert_type ?? SAME_BUNDLE_CLUSTER_ALERT_TYPE,
    bundleId: row.bundle_id ?? '',
    slot: row.slot ?? 0,
    walletAddress: row.wallet_address,
    txSignature: row.tx_signature ?? '',
    receiptId: row.receipt_id ?? '',
    participantCount: row.participant_count ?? 0,
    createdAt: row.created_at,
  }
}

function mapBundlerAlertRowToCreatorAlert(row: BundlerAlertRow): CreatorRecentBundlerAlert {
  return {
    alertId: row.id,
    launchId: row.launch_id,
    tokenName: row.token_name ?? 'Unknown launch',
    alertType: row.alert_type ?? SAME_BUNDLE_CLUSTER_ALERT_TYPE,
    bundleId: row.bundle_id ?? '',
    slot: row.slot ?? 0,
    txSignature: row.tx_signature ?? '',
    createdAt: row.created_at,
  }
}

export function countLaunchBundlerAlerts(launchId: string) {
  const row = db.prepare(`
    SELECT COUNT(*) AS alert_count
    FROM bundler_alerts
    WHERE launch_id = ?
  `).get(launchId) as { alert_count: number }

  return row.alert_count ?? 0
}

export function listLaunchBundlerAlerts(
  launchId: string,
  limit = DEFAULT_ALERT_LIMIT
): LaunchBundlerAlert[] {
  const rows = db.prepare(`
    SELECT *
    FROM bundler_alerts
    WHERE launch_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(launchId, limit) as BundlerAlertRow[]

  return rows.map(mapBundlerAlertRowToLaunchAlert)
}

export function listCreatorBundlerAlerts(
  walletAddress: string,
  limit = DEFAULT_ALERT_LIMIT
): CreatorRecentBundlerAlert[] {
  const rows = db.prepare(`
    SELECT
      bundler_alerts.*,
      launches.token_name
    FROM bundler_alerts
    INNER JOIN launches ON launches.id = bundler_alerts.launch_id
    WHERE launches.creator_wallet = ?
    ORDER BY bundler_alerts.created_at DESC
    LIMIT ?
  `).all(walletAddress, limit) as BundlerAlertRow[]

  return rows.map(mapBundlerAlertRowToCreatorAlert)
}

export function recordBundlerAlert(
  input: RecordBundlerAlertInput
): LaunchBundlerAlert | null {
  const walletAddress = input.trade.walletAddress ?? input.receipt.walletAddress

  if (!walletAddress) {
    return null
  }

  const priorParticipantRow = db.prepare(`
    SELECT COUNT(*) AS participant_count
    FROM receipts
    WHERE launch_id = ?
      AND bundle_id = ?
      AND wallet_address IS NOT NULL
      AND wallet_address != ?
  `).get(
    input.launch.launchId,
    input.receipt.bundleId,
    walletAddress
  ) as { participant_count: number }

  if ((priorParticipantRow.participant_count ?? 0) < 1) {
    return null
  }

  const duplicateAlert = db.prepare(`
    SELECT 1 FROM bundler_alerts
    WHERE receipt_id = ?
      AND alert_type = ?
    LIMIT 1
  `).get(
    input.receipt.receiptId,
    SAME_BUNDLE_CLUSTER_ALERT_TYPE
  ) as { 1: number } | undefined

  if (duplicateAlert) {
    const existingAlertRow = db.prepare(`
      SELECT *
      FROM bundler_alerts
      WHERE receipt_id = ?
        AND alert_type = ?
      LIMIT 1
    `).get(
      input.receipt.receiptId,
      SAME_BUNDLE_CLUSTER_ALERT_TYPE
    ) as BundlerAlertRow | undefined

    return existingAlertRow ? mapBundlerAlertRowToLaunchAlert(existingAlertRow) : null
  }

  const participantCountRow = db.prepare(`
    SELECT COUNT(DISTINCT wallet_address) AS participant_count
    FROM receipts
    WHERE launch_id = ?
      AND bundle_id = ?
      AND wallet_address IS NOT NULL
  `).get(
    input.launch.launchId,
    input.receipt.bundleId
  ) as { participant_count: number }

  const alertRow = db.transaction(() => {
    const alertId = uuidv4()

    db.prepare(`
      INSERT INTO bundler_alerts (
        id,
        launch_id,
        wallet_address,
        bundle_id,
        slot,
        alert_type,
        tx_signature,
        receipt_id,
        participant_count,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      alertId,
      input.launch.launchId,
      walletAddress,
      input.receipt.bundleId,
      input.receipt.slot,
      SAME_BUNDLE_CLUSTER_ALERT_TYPE,
      input.receipt.txSignature,
      input.receipt.receiptId,
      participantCountRow.participant_count ?? 0,
      input.trade.executedAt
    )

    syncLaunchBundlerAlertCount(input.launch.launchId)

    return db.prepare(`
      SELECT *
      FROM bundler_alerts
      WHERE id = ?
    `).get(alertId) as BundlerAlertRow
  })()

  return mapBundlerAlertRowToLaunchAlert(alertRow)
}
