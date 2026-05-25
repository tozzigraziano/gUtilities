'use strict';

const { Router } = require('express');
const { getAllSettings, getSetting, setSetting, replaceAllSettings } = require('../db');

const router = Router();

// GET /api/settings  → restituisce tutte le settings come oggetto {key: value}
router.get('/', (_req, res) => {
  res.json(getAllSettings());
});

// GET /api/settings/:key
router.get('/:key', (req, res) => {
  const value = getSetting(req.params.key);
  // Restituisce sempre 200: value è null se la chiave non esiste ancora.
  // Questo evita errori 404 in console per settings non ancora inizializzati.
  res.json({ key: req.params.key, value: value ?? null });
});

// PUT /api/settings/:key  → upsert singola setting
router.put('/:key', (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Campo value mancante' });
  setSetting(req.params.key, value);
  res.json({ key: req.params.key, value });
});

// POST /api/settings  → sostituisce tutte le settings (usato da import)
router.post('/', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Body deve essere un oggetto' });
  replaceAllSettings(data);
  res.json(getAllSettings());
});

module.exports = router;
