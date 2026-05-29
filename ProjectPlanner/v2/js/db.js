/**
 * js/db.js  –  Data Access Layer per ProjectPlanner v2
 *
 * Astrae la fonte dati: API backend (SQLite) oppure IndexedDB locale (cache offline).
 *
 * Flusso:
 *  - Avvio:  controlla se il backend è raggiungibile
 *  - Online:  legge/scrive da API → aggiorna cache IndexedDB
 *  - Offline: legge/scrive su IndexedDB → segna pending sync
 *  - Reconnect: invia i pending sync al backend
 *
 * Tutte le funzioni sono async/await.
 */

// ─── Configurazione ───────────────────────────────────────────────────────────

export const API_BASE = 'http://localhost:3001/api';
const IDB_NAME    = 'projectplanner_v2';
const IDB_VERSION = 1;
const STORES = ['resources', 'projects', 'templates', 'meetings', 'plants', 'localHolidays', 'settings'];

// ─── Stato interno ────────────────────────────────────────────────────────────

let _idb        = null;   // istanza IndexedDB
let _isOnline   = false;  // stato connessione backend
let _pendingSync = [];    // operazioni pending da sincronizzare [{action, store, id, data}]

// ─── Connessione status ────────────────────────────────────────────────────────

/** Ritorna true se il backend è attualmente raggiungibile. */
export function isOnline() { return _isOnline; }

/** Controlla la connessione al backend (timeout 2s). Aggiorna _isOnline. */
export async function checkConnection() {
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(2000)
    });
    _isOnline = res.ok;
  } catch {
    _isOnline = false;
  }
  _dispatchStatusEvent();
  return _isOnline;
}

function _dispatchStatusEvent() {
  window.dispatchEvent(new CustomEvent('db:connectionChanged', { detail: { online: _isOnline } }));
}

// ─── Inizializzazione ─────────────────────────────────────────────────────────

/** Inizializza IndexedDB (cache locale). Da chiamare all'avvio dell'app. */
export function initCache() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          if (store === 'settings') {
            db.createObjectStore(store);           // keyPath = undefined, usa key esplicita
          } else {
            db.createObjectStore(store, { keyPath: 'id' });
          }
        }
      }
      // Store per le pending sync operations
      if (!db.objectStoreNames.contains('_pending')) {
        db.createObjectStore('_pending', { autoIncrement: true });
      }
    };

    req.onsuccess = (e) => { _idb = e.target.result; resolve(); };
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Avvia il data layer: inizializza la cache, controlla la connessione.
 * Ritorna { online: bool }
 */
export async function init() {
  await initCache();
  await checkConnection();

  // Polling connessione ogni 15 secondi
  setInterval(async () => {
    const wasOnline = _isOnline;
    await checkConnection();
    if (!wasOnline && _isOnline) {
      // Appena tornato online: tenta sync pending
      await syncPending();
    }
  }, 15000);

  return { online: _isOnline };
}

// ─── IndexedDB helpers (cache locale) ─────────────────────────────────────────

function _idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx  = _idb.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

function _idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx  = _idb.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

function _idbPut(storeName, data, key) {
  return new Promise((resolve, reject) => {
    const tx  = _idb.transaction(storeName, 'readwrite');
    const req = key !== undefined
      ? tx.objectStore(storeName).put(data, key)
      : tx.objectStore(storeName).put(data);
    req.onsuccess = () => resolve(data);
    req.onerror   = () => reject(req.error);
  });
}

function _idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx  = _idb.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror   = () => reject(req.error);
  });
}

function _idbClearAndPutAll(storeName, items) {
  return new Promise((resolve, reject) => {
    const tx    = _idb.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ─── Pending sync ─────────────────────────────────────────────────────────────

function _addPending(operation) {
  _pendingSync.push(operation);
  // Persisti in IDB così sopravvive al refresh
  const tx = _idb.transaction('_pending', 'readwrite');
  tx.objectStore('_pending').add(operation);
}

/** Sincronizza tutte le operazioni pending con il backend. */
export async function syncPending() {
  if (!_isOnline) return;

  // Carica dal IDB (nel caso siano sopravvissuti a un refresh)
  const stored = await _idbGetAll('_pending');
  const ops = stored.length > 0 ? stored : _pendingSync;

  if (ops.length === 0) return;

  let synced = 0;
  for (const op of ops) {
    try {
      if (op.action === 'upsert') {
        await apiFetch(`/${op.store}/${op.data.id}`, 'PUT', op.data);
      } else if (op.action === 'delete') {
        await apiFetch(`/${op.store}/${op.id}`, 'DELETE');
      } else if (op.action === 'setting') {
        await apiFetch(`/settings/${op.key}`, 'PUT', { value: op.value });
      }
      synced++;
    } catch {
      // Se ancora offline, lascia pendenti
      break;
    }
  }

  if (synced > 0) {
    _pendingSync = [];
    const tx = _idb.transaction('_pending', 'readwrite');
    tx.objectStore('_pending').clear();
    console.info(`[db] Sincronizzate ${synced} operazioni pendenti.`);
  }
}

// ─── API fetch wrapper ─────────────────────────────────────────────────────────

const _AUTH_TOKEN_KEY = 'pp2_auth_token';

async function apiFetch(path, method = 'GET', body) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};

  // Aggiungi Bearer token se disponibile
  const token = localStorage.getItem(_AUTH_TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = {
    method,
    headers
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401) {
    // Sessione scaduta o token non valido: notifica l'app
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new Error('Sessione scaduta. Effettua il login.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── CRUD generico ─────────────────────────────────────────────────────────────

/**
 * Legge tutti i record di uno store.
 * Online:  legge da API + aggiorna cache
 * Offline: legge da cache
 */
export async function getAll(store) {
  if (_isOnline) {
    try {
      const apiStore = store === 'localHolidays' ? 'holidays/local' : store;
      const items = await apiFetch(`/${apiStore}`);
      await _idbClearAndPutAll(store, items);
      return items;
    } catch {
      _isOnline = false;
      _dispatchStatusEvent();
    }
  }
  return _idbGetAll(store);
}

/**
 * Legge un singolo record per id.
 * Online:  legge da API + aggiorna cache
 * Offline: legge da cache
 */
export async function getById(store, id) {
  if (_isOnline) {
    try {
      const apiStore = store === 'localHolidays' ? 'holidays/local' : store;
      const item = await apiFetch(`/${apiStore}/${id}`);
      await _idbPut(store, item);
      return item;
    } catch {
      // Fallback a cache
    }
  }
  return _idbGet(store, id);
}

/**
 * Crea o aggiorna un record (upsert).
 * Online:  scrive su API + aggiorna cache
 * Offline: scrive su cache + pending sync
 */
export async function save(store, data) {
  await _idbPut(store, data);

  if (_isOnline) {
    try {
      const apiStore = store === 'localHolidays' ? 'holidays/local' : store;
      return await apiFetch(`/${apiStore}/${data.id}`, 'PUT', data);
    } catch {
      _isOnline = false;
      _dispatchStatusEvent();
      _addPending({ action: 'upsert', store, data });
    }
  } else {
    _addPending({ action: 'upsert', store, data });
  }
  return data;
}

/**
 * Elimina un record per id.
 * Online:  elimina da API + rimuove da cache
 * Offline: rimuove da cache + pending sync
 */
export async function remove(store, id) {
  await _idbDelete(store, id);

  if (_isOnline) {
    try {
      const apiStore = store === 'localHolidays' ? 'holidays/local' : store;
      await apiFetch(`/${apiStore}/${id}`, 'DELETE');
      return true;
    } catch {
      _isOnline = false;
      _dispatchStatusEvent();
      _addPending({ action: 'delete', store, id });
    }
  } else {
    _addPending({ action: 'delete', store, id });
  }
  return true;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Legge tutte le settings. */
export async function getAllSettings() {
  if (_isOnline) {
    try {
      const obj = await apiFetch('/settings');
      // Aggiorna cache
      const tx = _idb.transaction('settings', 'readwrite');
      const st = tx.objectStore('settings');
      st.clear();
      for (const [k, v] of Object.entries(obj)) st.put(v, k);
      return obj;
    } catch { /* fallback */ }
  }
  // Da cache IDB
  const keys = await new Promise((res) => {
    const req = _idb.transaction('settings', 'readonly').objectStore('settings').getAllKeys();
    req.onsuccess = () => res(req.result ?? []);
  });
  const out = {};
  for (const k of keys) out[k] = await _idbGet('settings', k);
  return out;
}

/** Legge una singola setting per chiave. */
export async function getSetting(key) {
  if (_isOnline) {
    try {
      const res = await apiFetch(`/settings/${key}`);
      await _idbPut('settings', res.value, key);
      return res.value;
    } catch { /* fallback */ }
  }
  return _idbGet('settings', key);
}

/** Scrive una singola setting. */
export async function setSetting(key, value) {
  await _idbPut('settings', value, key);

  if (_isOnline) {
    try {
      await apiFetch(`/settings/${key}`, 'PUT', { value });
      return;
    } catch {
      _isOnline = false;
      _dispatchStatusEvent();
    }
  }
  _addPending({ action: 'setting', key, value });
}

// ─── Export / Import ──────────────────────────────────────────────────────────

/**
 * Scarica il backup JSON completo.
 * Online:  usa l'endpoint /api/export del backend
 * Offline: costruisce il payload dalla cache IDB
 */
export async function exportData() {
  if (_isOnline) {
    const payload = await apiFetch('/export');
    return payload;
  }
  // Costruisce offline dall'IDB cache
  const [resources, projects, templates, meetings, plants, localHolidays, settings] = await Promise.all([
    _idbGetAll('resources'),
    _idbGetAll('projects'),
    _idbGetAll('templates'),
    _idbGetAll('meetings'),
    _idbGetAll('plants'),
    _idbGetAll('localHolidays'),
    getAllSettings()
  ]);
  return {
    exportDate: new Date().toISOString(),
    version: '2',
    resources, projects, templates, meetings, plants, localHolidays, settings
  };
}

/**
 * Importa un payload JSON (full replace).
 * Online:  invia al backend /api/import
 * Offline: scrive in cache IDB + segna tutto come pending
 */
export async function importData(payload) {
  if (_isOnline) {
    return apiFetch('/import', 'POST', payload);
  }
  await _applyImportToCache(payload);
  // Segna un import bulk come pending
  _addPending({ action: 'upsert', store: '__import__', data: payload });
  return { success: true, message: 'Import salvato offline. Sarà sincronizzato al prossimo avvio del server.' };
}

/**
 * Importa con merge (solo id non esistenti).
 * Online:  invia al backend /api/import/merge
 * Offline: merge in cache IDB
 */
export async function importMerge(payload) {
  if (_isOnline) {
    return apiFetch('/import/merge', 'POST', payload);
  }
  await _applyMergeToCache(payload);
  _addPending({ action: 'upsert', store: '__import_merge__', data: payload });
  return { success: true, message: 'Import merge salvato offline. Sarà sincronizzato al prossimo avvio del server.' };
}

/**
 * Svuota completamente il database (backend + cache IDB).
 * Richiede connessione online (operazione solo-admin lato server).
 */
export async function wipeAll() {
  if (_isOnline) {
    await apiFetch('/wipe', 'DELETE');
  }
  // Svuota tutti gli store IDB
  const DATA_STORES = ['resources', 'projects', 'templates', 'meetings', 'plants', 'localHolidays'];
  for (const store of DATA_STORES) await _idbClearAndPutAll(store, []);
  await new Promise((resolve, reject) => {
    const tx = _idb.transaction('settings', 'readwrite');
    tx.objectStore('settings').clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
  await new Promise((resolve, reject) => {
    const tx = _idb.transaction('_pending', 'readwrite');
    tx.objectStore('_pending').clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
  _pendingSync = [];
}

async function _applyImportToCache(payload) {
  const storeMap = {
    resources: 'resources',
    projects: 'projects',
    templates: 'templates',
    meetings: 'meetings',
    plants: 'plants',
    localHolidays: 'localHolidays'
  };
  for (const [key, storeName] of Object.entries(storeMap)) {
    if (Array.isArray(payload[key])) await _idbClearAndPutAll(storeName, payload[key]);
  }
  if (payload.settings && typeof payload.settings === 'object') {
    const tx = _idb.transaction('settings', 'readwrite');
    const st = tx.objectStore('settings');
    st.clear();
    for (const [k, v] of Object.entries(payload.settings)) st.put(v, k);
  }
}

async function _applyMergeToCache(payload) {
  const storeMap = {
    resources: 'resources',
    projects: 'projects',
    templates: 'templates',
    meetings: 'meetings',
    plants: 'plants',
    localHolidays: 'localHolidays'
  };
  for (const [key, storeName] of Object.entries(storeMap)) {
    if (!Array.isArray(payload[key])) continue;
    const existing = new Set((await _idbGetAll(storeName)).map(i => i.id));
    for (const item of payload[key]) {
      if (!existing.has(item.id)) await _idbPut(storeName, item);
    }
  }
}
