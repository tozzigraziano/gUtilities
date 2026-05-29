'use strict';

/**
 * Route per i progetti.
 * - Utenti personal: GET filtrato ai soli progetti in cui sono assegnati
 * - Scritture (POST/PUT/DELETE): solo admin ed editor
 */
const { Router } = require('express');
const { getAll, getById, upsert, deleteById } = require('../db');

const router = Router();
const WRITE_ROLES = ['admin', 'editor'];

// Controlla se un utente personal è assegnato al progetto
function _personalHasAccess(project, resourceId) {
  return project.tasks?.some(t =>
    t.resources?.some(r => r.resourceId === resourceId)
  ) ?? false;
}

// GET / – lista progetti (filtrata per personal)
router.get('/', (req, res) => {
  let projects = getAll('projects');
  if (req.user.role === 'personal' && req.user.resourceId) {
    projects = projects.filter(p => _personalHasAccess(p, req.user.resourceId));
  }
  res.json(projects);
});

// GET /:id
router.get('/:id', (req, res) => {
  const item = getById('projects', req.params.id);
  if (!item) return res.status(404).json({ error: 'Non trovato' });
  if (req.user.role === 'personal' && req.user.resourceId) {
    if (!_personalHasAccess(item, req.user.resourceId))
      return res.status(403).json({ error: 'Accesso negato' });
  }
  res.json(item);
});

// POST / – solo admin ed editor
router.post('/', (req, res) => {
  if (!WRITE_ROLES.includes(req.user?.role))
    return res.status(403).json({ error: 'Accesso negato: sola lettura' });
  const data = req.body;
  if (!data?.id) return res.status(400).json({ error: 'id mancante' });
  res.status(201).json(upsert('projects', data.id, data));
});

// PUT /:id – solo admin ed editor
router.put('/:id', (req, res) => {
  if (!WRITE_ROLES.includes(req.user?.role))
    return res.status(403).json({ error: 'Accesso negato: sola lettura' });
  const data = req.body;
  if (!data) return res.status(400).json({ error: 'Body mancante' });
  data.id = req.params.id;
  res.json(upsert('projects', req.params.id, data));
});

// DELETE /:id – solo admin ed editor
router.delete('/:id', (req, res) => {
  if (!WRITE_ROLES.includes(req.user?.role))
    return res.status(403).json({ error: 'Accesso negato: sola lettura' });
  const deleted = deleteById('projects', req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Non trovato' });
  res.json({ success: true });
});

module.exports = router;

