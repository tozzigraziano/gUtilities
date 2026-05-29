'use strict';

const { Router } = require('express');
const { getAll, getById, upsert, deleteById } = require('../db');
const { requireEditor } = require('../middleware/auth');

const TABLE = 'resources';
const router = Router();

// ─── Controllo permessi per editor ────────────────────────────────────────────
// Gli editor possono scrivere solo risorse del tipo a loro consentito.
// Se allowedResourceTypes è vuoto [], l'editor può gestire tutti i tipi.
function checkEditorResourceType(req, res, next) {
  const user = req.user;
  // Admin: accesso totale
  if (user.role === 'admin') return next();

  const resourceType = req.body?.type;
  const allowed = user.allowedResourceTypes || [];

  // Editor senza restrizioni sui tipi: accesso totale
  if (allowed.length === 0) return next();

  // Se il tipo non è nella lista permessa: nega
  if (!resourceType || !allowed.includes(resourceType)) {
    return res.status(403).json({
      error: `Tipo risorsa '${resourceType || '(non specificato)'}' non consentito per questo account`
    });
  }
  next();
}

router.get('/', (_req, res) => {
  res.json(getAll(TABLE));
});

router.get('/:id', (req, res) => {
  const item = getById(TABLE, req.params.id);
  if (!item) return res.status(404).json({ error: 'Non trovato' });
  res.json(item);
});

router.post('/', requireEditor, checkEditorResourceType, (req, res) => {
  const data = req.body;
  if (!data || !data.id) return res.status(400).json({ error: 'id mancante' });
  res.status(201).json(upsert(TABLE, data.id, data));
});

router.put('/:id', requireEditor, checkEditorResourceType, (req, res) => {
  const data = req.body;
  if (!data) return res.status(400).json({ error: 'Body mancante' });
  data.id = req.params.id;
  res.json(upsert(TABLE, req.params.id, data));
});

router.delete('/:id', requireEditor, (req, res) => {
  // Per il DELETE, recupera la risorsa dal DB per verificare il tipo
  const user = req.user;
  if (user.role !== 'admin' && (user.allowedResourceTypes || []).length > 0) {
    const existing = getById(TABLE, req.params.id);
    if (existing && !user.allowedResourceTypes.includes(existing.type)) {
      return res.status(403).json({
        error: `Tipo risorsa '${existing.type}' non consentito per questo account`
      });
    }
  }
  const deleted = deleteById(TABLE, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Non trovato' });
  res.json({ success: true });
});

module.exports = router;
