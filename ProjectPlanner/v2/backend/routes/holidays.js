'use strict';

/**
 * Route per le festività locali.
 * Usa la tabella `local_holidays`.
 * Ogni voce ha id generato come "MMDD_nome" per unicità.
 */
const { Router } = require('express');
const { getAll, getById, upsert, deleteById } = require('../db');

const TABLE = 'local_holidays';
const router = Router();
const WRITE_ROLES = ['admin', 'editor'];

// GET /api/holidays/local
router.get('/local', (_req, res) => {
  res.json(getAll(TABLE));
});

// GET /api/holidays/local/:id
router.get('/local/:id', (req, res) => {
  const item = getById(TABLE, req.params.id);
  if (!item) return res.status(404).json({ error: 'Non trovato' });
  res.json(item);
});

// POST /api/holidays/local
router.post('/local', (req, res) => {
  if (!WRITE_ROLES.includes(req.user?.role))
    return res.status(403).json({ error: 'Accesso negato: sola lettura' });
  const data = req.body;
  if (!data || !data.id) return res.status(400).json({ error: 'id mancante' });
  res.status(201).json(upsert(TABLE, data.id, data));
});

// PUT /api/holidays/local/:id
router.put('/local/:id', (req, res) => {
  if (!WRITE_ROLES.includes(req.user?.role))
    return res.status(403).json({ error: 'Accesso negato: sola lettura' });
  const data = req.body;
  if (!data) return res.status(400).json({ error: 'Body mancante' });
  data.id = req.params.id;
  res.json(upsert(TABLE, req.params.id, data));
});

// DELETE /api/holidays/local/:id
router.delete('/local/:id', (req, res) => {
  if (!WRITE_ROLES.includes(req.user?.role))
    return res.status(403).json({ error: 'Accesso negato: sola lettura' });
  const deleted = deleteById(TABLE, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Non trovato' });
  res.json({ success: true });
});

module.exports = router;
