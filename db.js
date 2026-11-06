'use strict';
// PostgreSQL access + automatic schema creation on boot (no manual migrations).
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10,
});
pool.on('error', e => console.error('[pg] idle client error', e.message));

const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
const all = async (text, params) => (await pool.query(text, params)).rows;
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; }
  finally { c.release(); }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  status_text TEXT NOT NULL DEFAULT '',
  presence TEXT NOT NULL DEFAULT 'online',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS servers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  server_id INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  permissions INT NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS members (
  server_id INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  timeout_until TIMESTAMPTZ,
  PRIMARY KEY (server_id, user_id)
);
CREATE TABLE IF NOT EXISTS member_roles (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  server_id INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  creator_id INT REFERENCES users(id) ON DELETE SET NULL,
  uses INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bans (
  server_id INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);
CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  server_id INT REFERENCES servers(id) ON DELETE CASCADE,
  parent_id INT REFERENCES channels(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('category','text','voice','dm','group')),
  name TEXT NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0,
  owner_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channels_server ON channels(server_id);
CREATE TABLE IF NOT EXISTS dm_members (
  channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS dm_members_user ON dm_members(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  reply_to INT REFERENCES messages(id) ON DELETE SET NULL,
  attachments JSONB NOT NULL DEFAULT '[]',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id, id DESC);
CREATE TABLE IF NOT EXISTS reactions (
  message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS reads (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_id INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel_id)
);
CREATE TABLE IF NOT EXISTS friend_requests (
  from_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS friends (
  a_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (a_id, b_id),
  CHECK (a_id < b_id)
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, blocked_id)
);

-- additions (idempotent): blue ticks, forced-logout version, site settings, admin audit log
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_log (
  id SERIAL PRIMARY KEY,
  admin_id INT REFERENCES users(id) ON DELETE SET NULL,
  admin_name TEXT,
  action TEXT NOT NULL,
  target TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const getSetting = async (key, def = '') => { const r = await one('SELECT value FROM settings WHERE key=$1', [key]); return r ? r.value : def; };
const setSetting = (key, value) => q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, String(value)]);

// Wait for Postgres (Railway may start the app before the DB accepts connections), then create tables.
async function init() {
  let lastErr;
  for (let i = 1; i <= 20; i++) {
    try { await pool.query('SELECT 1'); lastErr = null; break; }
    catch (e) { lastErr = e; console.warn(`[db] waiting for database (${i}/20): ${e.message}`); await new Promise(r => setTimeout(r, 2000)); }
  }
  if (lastErr) throw lastErr;
  await pool.query(SCHEMA);
  console.log('[db] schema ready');
}

module.exports = { pool, q, one, all, tx, init, getSetting, setSetting };
