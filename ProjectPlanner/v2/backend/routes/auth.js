'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { getUserByUsername, getUserById, updateUserPassword } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = Router();

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username e password richiesti' });
  }

  const user = getUserByUsername(username);
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Credenziali non valide' });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenziali non valide' });
  }

  const token = signToken({
    userId:               user.id,
    username:             user.username,
    role:                 user.role,
    allowedResourceTypes: user.allowed_resource_types,
    resourceId:           user.resource_id
  });

  res.json({
    token,
    user: {
      id:                   user.id,
      username:             user.username,
      role:                 user.role,
      allowedResourceTypes: user.allowed_resource_types
    }
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Entrambe le password sono richieste' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'La nuova password deve essere di almeno 4 caratteri' });
  }

  const user = getUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Password attuale errata' });
  }

  updateUserPassword(user.id, bcrypt.hashSync(newPassword, 10));
  res.json({ success: true });
});

module.exports = router;
