'use strict';

/**
 * Factory per generare routes CRUD standard.
 * Tutte le entità (projects, templates, meetings, plants) usano lo stesso pattern.
 */
const { Router } = require('express');
const { getAll, getById, upsert, deleteById } = require('../db');

const WRITE_ROLES = ['admin', 'editor'];

function makeCrudRouter(tableName) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(getAll(tableName));
  });

  router.get('/:id', (req, res) => {
    const item = getById(tableName, req.params.id);
    if (!item) return res.status(404).json({ error: 'Non trovato' });
    res.json(item);
  });

  router.post('/', (req, res) => {
    if (!WRITE_ROLES.includes(req.user?.role))
      return res.status(403).json({ error: 'Accesso negato: sola lettura' });
    const data = req.body;
    if (!data || !data.id) return res.status(400).json({ error: 'id mancante' });
    res.status(201).json(upsert(tableName, data.id, data));
  });

  router.put('/:id', (req, res) => {
    if (!WRITE_ROLES.includes(req.user?.role))
      return res.status(403).json({ error: 'Accesso negato: sola lettura' });
    const data = req.body;
    if (!data) return res.status(400).json({ error: 'Body mancante' });
    data.id = req.params.id;
    res.json(upsert(tableName, req.params.id, data));
  });

  router.delete('/:id', (req, res) => {
    if (!WRITE_ROLES.includes(req.user?.role))
      return res.status(403).json({ error: 'Accesso negato: sola lettura' });
    const deleted = deleteById(tableName, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Non trovato' });
    res.json({ success: true });
  });

  return router;
}

module.exports = makeCrudRouter;
