import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(__dirname, '../data/lumen.db')

export const db = new Database(DB_PATH)

type TableInfoRow = {
  name: string
}

function hasColumn(tableName: string, columnName: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[]
  return columns.some(column => column.name === columnName)
}

function ensureColumn(tableName: string, columnName: string, definition: string) {
  if (!hasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`)
  }
}

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL')

// RECEIPTS TABLE
// Every trade/transaction that gets stamped
db.exec(`
  CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    tx_signature TEXT NOT NULL UNIQUE,
    bundle_id TEXT,
    slot INTEGER,
    confirmation_status TEXT,
    receipt_hash TEXT NOT NULL,
    on_chain_memo TEXT,
    attestation_level TEXT DEFAULT 'BUNDLE_VERIFIED',
    launch_id TEXT,
    wallet_address TEXT,
    verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`)

// LAUNCHES TABLE
// Every token launch created through Lumen
db.exec(`
  CREATE TABLE IF NOT EXISTS launches (
    id TEXT PRIMARY KEY,
    token_name TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    token_mint TEXT,
    creator_wallet TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    liquidity_locked INTEGER DEFAULT 0,
    lock_duration_days INTEGER DEFAULT 0,
    max_wallet_cap REAL,
    launch_window_seconds INTEGER DEFAULT 60,
    status TEXT DEFAULT 'pending',
    bundler_alerts INTEGER DEFAULT 0,
    holder_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    launched_at INTEGER
  )
`)

ensureColumn('launches', 'alpha_vault_address', 'alpha_vault_address TEXT')
ensureColumn('launches', 'alpha_vault_mode', "alpha_vault_mode TEXT DEFAULT 'FCFS'")
ensureColumn('launches', 'alpha_vault_activation_at', 'alpha_vault_activation_at INTEGER')
ensureColumn('launches', 'dbc_config_address', 'dbc_config_address TEXT')
ensureColumn('launches', 'dbc_pool_address', 'dbc_pool_address TEXT')
ensureColumn('launches', 'activated_at', 'activated_at INTEGER')

// CREATORS TABLE
// Creator profiles and reputation
db.exec(`
  CREATE TABLE IF NOT EXISTS creators (
    wallet_address TEXT PRIMARY KEY,
    display_name TEXT,
    twitter_handle TEXT,
    verified INTEGER DEFAULT 0,
    total_launches INTEGER DEFAULT 0,
    successful_launches INTEGER DEFAULT 0,
    reputation_score REAL DEFAULT 0,
    liquidity_rug_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_active INTEGER
  )
`)

// USERS TABLE
// Traders who use the platform
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    wallet_address TEXT PRIMARY KEY,
    username TEXT,
    total_trades INTEGER DEFAULT 0,
    total_receipts INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_active INTEGER,
    updated_at INTEGER
  )
`)

ensureColumn('users', 'username', 'username TEXT')
ensureColumn('users', 'updated_at', 'updated_at INTEGER')

// WEBHOOK SUBSCRIPTIONS TABLE
// External integrators that receive receipt-issued events
db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id TEXT PRIMARY KEY,
    target_url TEXT NOT NULL,
    event_type TEXT NOT NULL,
    signing_secret TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_receipts_created_at
  ON receipts (created_at DESC)
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_receipts_launch_id
  ON receipts (launch_id)
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_launches_creator_wallet
  ON launches (creator_wallet)
`)

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (username COLLATE NOCASE)
  WHERE username IS NOT NULL
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_event_active
  ON webhook_subscriptions (event_type, active)
`)

// WEBHOOK DELIVERIES TABLE
// Delivery attempts for outbound receipt-issued events
db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    receipt_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER DEFAULT 1,
    response_status INTEGER,
    error_message TEXT,
    delivered_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription_created
  ON webhook_deliveries (subscription_id, created_at DESC)
`)

// BUNDLER ALERTS TABLE
// Log of detected bundling activity on launches
db.exec(`
  CREATE TABLE IF NOT EXISTS bundler_alerts (
    id TEXT PRIMARY KEY,
    launch_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    bundle_id TEXT,
    slot INTEGER,
    alert_type TEXT,
    created_at INTEGER NOT NULL
  )
`)

ensureColumn('bundler_alerts', 'tx_signature', 'tx_signature TEXT')
ensureColumn('bundler_alerts', 'receipt_id', 'receipt_id TEXT')
ensureColumn('bundler_alerts', 'participant_count', 'participant_count INTEGER DEFAULT 0')

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_bundler_alerts_launch_created
  ON bundler_alerts (launch_id, created_at DESC)
`)

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_bundler_alerts_receipt_id
  ON bundler_alerts (receipt_id)
`)

console.log('Database initialized successfully')

export default db
