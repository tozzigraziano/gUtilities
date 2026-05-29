'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { getAllUsers, getUserById, createUser, updateUser, deleteUser, updateUserPassword } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const VALID_ROLES = ['admin', 'editor', 'viewer', 'personal'];

const router = Router();

// Tutte le route utenti richiedono autenticazione + ruolo admin
router.use(requireAuth, requireAdmin);

// ─── GET /api/users ───────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  res.json(getAllUsers());
});

// ─── POST /api/users ──────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { username, password, role, allowedResourceTypes, resourceId } = req.body || {};

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password e role sono richiesti' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Ruolo non valido. Valori possibili: ${VALID_ROLES.join(', ')}` });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password troppo breve (min 4 caratteri)' });
  }

  const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const hash = bcrypt.hashSync(password, 10);

  try {
    const user = createUser(id, username, hash, role, allowedResourceTypes || [], resourceId || null);
    res.status(201).json(user);
  } catch (e) {
    if (e.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username già in uso' });
    }
    throw e;
  }
});

// ─── PUT /api/users/:id ───────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const { username, role, allowedResourceTypes, resourceId, isActive, newPassword } = req.body || {};

  const existing = getUserById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Utente non trovato' });

  // Protezione: non declassare l'unico admin
  if (existing.role === 'admin' && role && role !== 'admin') {
    const admins = getAllUsers().filter(u => u.role === 'admin' && u.is_active);
    if (admins.length <= 1) {
      return res.status(400).json({ error: 'Impossibile rimuovere il ruolo admin all\'unico amministratore' });
    }
  }

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Ruolo non valido. Valori possibili: ${VALID_ROLES.join(', ')}` });
  }

  const updated = updateUser(
    req.params.id,
    username    !== undefined ? username    : existing.username,
    role        !== undefined ? role        : existing.role,
    allowedResourceTypes !== undefined ? allowedResourceTypes : existing.allowed_resource_types,
    resourceId  !== undefined ? resourceId  : existing.resource_id,
    isActive    !== undefined ? isActive    : existing.is_active
  );

  if (newPassword) {
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Password troppo breve (min 4 caratteri)' });
    }
    updateUserPassword(req.params.id, bcrypt.hashSync(newPassword, 10));
  }

  res.json(updated);
});

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const existing = getUserById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Utente non trovato' });

  if (existing.role === 'admin') {
    const admins = getAllUsers().filter(u => u.role === 'admin' && u.is_active);
    if (admins.length <= 1) {
      return res.status(400).json({ error: 'Impossibile eliminare l\'unico amministratore' });
    }
  }

  deleteUser(req.params.id);
  res.json({ success: true });
});

module.exports = router;
