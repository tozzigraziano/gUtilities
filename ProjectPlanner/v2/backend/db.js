'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.db');
const db = new Database(DB_PATH);

// WAL mode: migliora le performance in lettura concorrente
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ─── Schema ───────────────────────────────────────────────────────────────────
// Strategia: ogni entità è archiviata come JSON nella colonna `data`.
// Gli id sono estratti come colonne separate per permettere lookup rapidi.
// Questa scelta evita migrazioni complesse quando si aggiungono campi alle entità.

db.exec(`
  CREATE TABLE IF NOT EXISTS resources (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    updated_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    updated_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS templates (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    updated_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    updated_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS plants (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    updated_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS local_holidays (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    updated_at  INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id                     TEXT PRIMARY KEY,
    username               TEXT UNIQUE NOT NULL,
    password_hash          TEXT NOT NULL,
    role                   TEXT NOT NULL DEFAULT 'viewer',
    allowed_resource_types TEXT NOT NULL DEFAULT '[]',
    resource_id            TEXT,
    is_active              INTEGER NOT NULL DEFAULT 1,
    created_at             TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Prepared statements ──────────────────────────────────────────────────────
const stmts = {};

function getStmt(tableName) {
  if (!stmts[tableName]) {
    stmts[tableName] = {
      getAll:  db.prepare(`SELECT data FROM ${tableName} ORDER BY updated_at ASC`),
      getById: db.prepare(`SELECT data FROM ${tableName} WHERE id = ?`),
      upsert:  db.prepare(`
        INSERT INTO ${tableName} (id, data, updated_at) VALUES (?, ?, strftime('%s', 'now'))
        ON CONFLICT(id) DO UPDATE SET
          data       = excluded.data,
          updated_at = excluded.updated_at
      `),
      delete:  db.prepare(`DELETE FROM ${tableName} WHERE id = ?`),
      deleteAll: db.prepare(`DELETE FROM ${tableName}`)
    };
  }
  return stmts[tableName];
}

// ─── Generic CRUD helpers ─────────────────────────────────────────────────────

/** Ritorna tutti i record di una tabella come array di oggetti. */
function getAll(tableName) {
  return getStmt(tableName).getAll.all().map(row => JSON.parse(row.data));
}

/** Ritorna un singolo record per id, o null se non trovato. */
function getById(tableName, id) {
  const row = getStmt(tableName).getById.get(id);
  return row ? JSON.parse(row.data) : null;
}

/** Crea o aggiorna un record (upsert). Ritorna l'oggetto salvato. */
function upsert(tableName, id, data) {
  getStmt(tableName).upsert.run(id, JSON.stringify(data));
  return data;
}

/** Elimina un record per id. Ritorna true se eliminato, false se non trovato. */
function deleteById(tableName, id) {
  const result = getStmt(tableName).delete.run(id);
  return result.changes > 0;
}

/**
 * Sostituisce l'intera tabella con l'array fornito (usato durante import).
 * Eseguito in una transazione atomica.
 */
function replaceAll(tableName, items) {
  const s = getStmt(tableName);
  const tx = db.transaction((rows) => {
    s.deleteAll.run();
    for (const item of rows) {
      s.upsert.run(item.id, JSON.stringify(item));
    }
  });
  tx(items);
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

const settingStmts = {
  getAll:  db.prepare(`SELECT key, value FROM settings`),
  get:     db.prepare(`SELECT value FROM settings WHERE key = ?`),
  set:     db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),
  deleteAll: db.prepare(`DELETE FROM settings`)
};

/** Ritorna tutte le settings come oggetto {key: value}. */
function getAllSettings() {
  const rows = settingStmts.getAll.all();
  const out = {};
  for (const row of rows) {
    try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = row.value; }
  }
  return out;
}

/** Legge un singolo valore di setting. */
function getSetting(key) {
  const row = settingStmts.get.get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

/** Scrive un singolo valore di setting. */
function setSetting(key, value) {
  settingStmts.set.run(key, JSON.stringify(value));
}

/** Sostituisce tutte le settings (usato durante import). */
function replaceAllSettings(settingsObj) {
  const tx = db.transaction((obj) => {
    settingStmts.deleteAll.run();
    for (const [key, value] of Object.entries(obj)) {
      settingStmts.set.run(key, JSON.stringify(value));
    }
  });
  tx(settingsObj);
}

// ─── Users ────────────────────────────────────────────────────────────────────

const userStmts = {
  getAll: db.prepare(`
    SELECT id, username, role, allowed_resource_types, resource_id, is_active, created_at
    FROM users ORDER BY created_at ASC
  `),
  getById:        db.prepare(`SELECT * FROM users WHERE id = ?`),
  getByUsername:  db.prepare(`SELECT * FROM users WHERE username = ?`),
  insert: db.prepare(`
    INSERT INTO users (id, username, password_hash, role, allowed_resource_types, resource_id, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `),
  update: db.prepare(`
    UPDATE users SET username=?, role=?, allowed_resource_types=?, resource_id=?, is_active=? WHERE id=?
  `),
  updatePassword: db.prepare(`UPDATE users SET password_hash=? WHERE id=?`),
  delete:         db.prepare(`DELETE FROM users WHERE id=?`)
};

function _parseUser(u) {
  if (!u) return null;
  return {
    ...u,
    allowed_resource_types: JSON.parse(u.allowed_resource_types || '[]'),
    is_active: u.is_active === 1
  };
}

function getAllUsers() {
  return userStmts.getAll.all().map(_parseUser);
}

function getUserById(id) {
  return _parseUser(userStmts.getById.get(id));
}

function getUserByUsername(username) {
  return _parseUser(userStmts.getByUsername.get(username));
}

function createUser(id, username, passwordHash, role, allowedResourceTypes, resourceId) {
  userStmts.insert.run(id, username, passwordHash, role,
    JSON.stringify(allowedResourceTypes || []), resourceId || null);
  return getUserById(id);
}

function updateUser(id, username, role, allowedResourceTypes, resourceId, isActive) {
  userStmts.update.run(username, role,
    JSON.stringify(allowedResourceTypes || []), resourceId || null,
    isActive ? 1 : 0, id);
  return getUserById(id);
}

function updateUserPassword(id, passwordHash) {
  userStmts.updatePassword.run(passwordHash, id);
}

function deleteUser(id) {
  return userStmts.delete.run(id).changes > 0;
}

// ─── Export ───────────────────────────────────────────────────────────────────
module.exports = {
  db,
  getAll,
  getById,
  upsert,
  deleteById,
  replaceAll,
  getAllSettings,
  getSetting,
  setSetting,
  replaceAllSettings,
  // Users
  getAllUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  updateUserPassword,
  deleteUser
};
