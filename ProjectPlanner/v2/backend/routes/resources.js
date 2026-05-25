'use strict';

const { Router } = require('express');
const { getAll, getById, upsert, deleteById } = require('../db');

const TABLE = 'resources';
const router = Router();

router.get('/', (_req, res) => {
  res.json(getAll(TABLE));
});

router.get('/:id', (req, res) => {
  const item = getById(TABLE, req.params.id);
  if (!item) return res.status(404).json({ error: 'Non trovato' });
  res.json(item);
});

router.post('/', (req, res) => {
  const data = req.body;
  if (!data || !data.id) return res.status(400).json({ error: 'id mancante' });
  res.status(201).json(upsert(TABLE, data.id, data));
});

router.put('/:id', (req, res) => {
  const data = req.body;
  if (!data) return res.status(400).json({ error: 'Body mancante' });
  data.id = req.params.id;
  res.json(upsert(TABLE, req.params.id, data));
});

router.delete('/:id', (req, res) => {
  const deleted = deleteById(TABLE, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Non trovato' });
  res.json({ success: true });
});

module.exports = router;
