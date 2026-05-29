'use strict';

/**
 * Route Export / Import.
 * Il formato JSON è compatibile al 100% con il formato usato dalla v1 (IndexedDB export).
 *
 * Struttura del file:
 * {
 *   exportDate: "ISO string",
 *   version: "2",
 *   resources: [...],
 *   projects: [...],
 *   templates: [...],
 *   meetings: [...],
 *   plants: [...],
 *   localHolidays: [...],
 *   settings: { key: value, ... }
 * }
 */

const { Router } = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  getAll, replaceAll,
  getAllSettings, replaceAllSettings
} = require('../db');

const router = Router();

// ─── GET /api/export ──────────────────────────────────────────────────────────
router.get('/export', requireAuth, (_req, res) => {
  const payload = buildExport();
  res
    .setHeader('Content-Type', 'application/json')
    .setHeader('Content-Disposition', `attachment; filename="project-planner-backup-${dateTag()}.json"`)
    .json(payload);
});

// ─── POST /api/import  (full replace) ─────────────────────────────────────────
router.post('/import', requireAuth, requireAdmin, (req, res) => {
  const data = req.body;
  if (!isValidPayload(data)) return res.status(400).json({ error: 'Payload non valido' });

  applyImport(data, false);
  res.json({ success: true, message: 'Import completato (tutti i dati sostituiti).' });
});

// ─── POST /api/import/merge  (additive merge, no overwrites) ──────────────────
router.post('/import/merge', requireAuth, requireAdmin, (req, res) => {
  const data = req.body;
  if (!isValidPayload(data)) return res.status(400).json({ error: 'Payload non valido' });

  const stats = applyImport(data, true);
  res.json({ success: true, message: 'Import con merge completato.', stats });
});

// ─── DELETE /api/wipe  (cancella tutti i dati, solo admin) ───────────────────
router.delete('/wipe', requireAuth, requireAdmin, (req, res) => {
  const TABLES = ['resources', 'projects', 'templates', 'meetings', 'plants', 'local_holidays'];
  for (const table of TABLES) replaceAll(table, []);
  replaceAllSettings({});
  res.json({ success: true, message: 'Database pulito con successo.' });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildExport() {
  return {
    exportDate: new Date().toISOString(),
    version: '2',
    resources:     getAll('resources'),
    projects:      getAll('projects'),
    templates:     getAll('templates'),
    meetings:      getAll('meetings'),
    plants:        getAll('plants'),
    localHolidays: getAll('local_holidays'),
    settings:      getAllSettings()
  };
}

function isValidPayload(data) {
  return data && typeof data === 'object' && !Array.isArray(data);
}

function applyImport(data, merge) {
  const stats = { added: {}, skipped: {} };

  const tables = [
    { key: 'resources',     table: 'resources' },
    { key: 'projects',      table: 'projects' },
    { key: 'templates',     table: 'templates' },
    { key: 'meetings',      table: 'meetings' },
    { key: 'plants',        table: 'plants' },
    { key: 'localHolidays', table: 'local_holidays' }
  ];

  if (!merge) {
    // Full replace: svuota e ricarica ogni tabella
    for (const { key, table } of tables) {
      const items = Array.isArray(data[key]) ? data[key] : [];
      replaceAll(table, items);
      stats.added[key] = items.length;
    }
    if (data.settings && typeof data.settings === 'object') {
      replaceAllSettings(data.settings);
    }
    // Compatibilità v1: quickNotes come array separato → salva come setting
    if (Array.isArray(data.quickNotes)) {
      const { setSetting } = require('../db');
      setSetting('quickNotes', data.quickNotes);
    }
  } else {
    // Merge: importa solo id non presenti
    const { getAll: dbGetAll, upsert } = require('../db');
    for (const { key, table } of tables) {
      const incoming = Array.isArray(data[key]) ? data[key] : [];
      const existing = new Set(dbGetAll(table).map(i => i.id));
      let added = 0;
      for (const item of incoming) {
        if (!existing.has(item.id)) {
          upsert(table, item.id, item);
          added++;
        }
      }
      stats.added[key]   = added;
      stats.skipped[key] = incoming.length - added;
    }
    // Settings: merge additive (non sovrascrive quelle esistenti)
    if (data.settings && typeof data.settings === 'object') {
      const { getSetting, setSetting } = require('../db');
      for (const [k, v] of Object.entries(data.settings)) {
        if (getSetting(k) === null) setSetting(k, v);
      }
    }
    // Compatibilità v1: quickNotes come array separato → merge con setting esistenti
    if (Array.isArray(data.quickNotes) && data.quickNotes.length > 0) {
      const { getSetting, setSetting } = require('../db');
      const existing = getSetting('quickNotes') ?? [];
      const existingIds = new Set((existing || []).map(n => n.id));
      const toAdd = data.quickNotes.filter(n => !existingIds.has(n.id));
      if (toAdd.length > 0) setSetting('quickNotes', [...(existing || []), ...toAdd]);
    }
  }

  return stats;
}

function dateTag() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = router;
