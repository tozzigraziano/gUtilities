'use strict';

const jwt = require('jsonwebtoken');

// ─── Configurazione ───────────────────────────────────────────────────────────
// Il secret viene letto dalla variabile d'ambiente JWT_SECRET.
// Per una LAN app con dati non sensibili, un fallback hard-coded è accettabile,
// ma l'utente dovrebbe impostare la variabile d'ambiente in produzione.
const JWT_SECRET  = process.env.JWT_SECRET || 'pp2-local-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Genera un JWT con i dati dell'utente. */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/** Verifica e decodifica un JWT. Lancia eccezione se non valido. */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/** Verifica il JWT e attacca req.user alla richiesta. */
function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  try {
    req.user = verifyToken(auth.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }
}

/** Solo admin. Da usare DOPO requireAuth. */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accesso negato: ruolo insufficiente' });
  }
  next();
}

/** Admin o editor. Da usare DOPO requireAuth. */
function requireEditor(req, res, next) {
  if (!['admin', 'editor'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Accesso negato: sola lettura' });
  }
  next();
}

module.exports = { signToken, verifyToken, requireAuth, requireAdmin, requireEditor };
