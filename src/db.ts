import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const DB_PATH = path.join(__dirname, '../data/lumen.db')
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL')

// RECEIPTS TABLE
// Every transaction that gets stamped into a verifiable receipt
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
    wallet_address TEXT,
    verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`)

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

console.log('Database initialized successfully')

export default db
