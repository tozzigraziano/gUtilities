'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security: CORS restricted to localhost + LAN origins ───────────────────
const allowedOrigins = [
  'http://localhost',
  'http://127.0.0.1',
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  // Rete locale: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
  /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
  /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
  /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?$/,
  // file:// origin (null) for when index.html is opened directly from disk
  null
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => o instanceof RegExp ? o.test(origin) : o === origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' non consentita`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: Date.now() });
});

// ─── Auth routes (no auth middleware) ────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));

// ─── Auth middleware per tutte le altre route API ─────────────────────────────
const { requireAuth } = require('./middleware/auth');
app.use('/api', requireAuth);

// ─── Routes protette ──────────────────────────────────────────────────────────
app.use('/api/resources',      require('./routes/resources'));
app.use('/api/projects',       require('./routes/projects'));
app.use('/api/templates',      require('./routes/templates'));
app.use('/api/meetings',       require('./routes/meetings'));
app.use('/api/plants',         require('./routes/plants'));
app.use('/api/holidays',       require('./routes/holidays'));
app.use('/api/settings',       require('./routes/settings'));
app.use('/api/users',          require('./routes/users'));
app.use('/api',                require('./routes/exportImport'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: Date.now() });
});

// ─── Serve frontend static files ──────────────────────────────────────────────
// Serve the v2 folder (parent of backend/) as static files
const frontendPath = path.join(__dirname, '..');
app.use(express.static(frontendPath));

// SPA fallback: serve index.html for any unmatched route
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const lanIPs = Object.values(nets).flat()
    .filter(n => n.family === 'IPv4' && !n.internal)
    .map(n => n.address);
  console.log(`\n  ProjectPlanner v2 Backend\n`);
  console.log(`  Locale:  http://localhost:${PORT}/index.html`);
  lanIPs.forEach(ip => console.log(`  LAN:     http://${ip}:${PORT}/index.html`));
  console.log(`  Health:  http://localhost:${PORT}/api/health\n`);
  console.log('  Premi CTRL+C per fermare il server.\n');

  // ─── Seed admin user (prima esecuzione) ──────────────────────────────────
  const { getAllUsers, createUser } = require('./db');
  const admins = getAllUsers().filter(u => u.role === 'admin');
  if (admins.length === 0) {
    const id   = `admin_${Date.now()}`;
    const hash = bcrypt.hashSync('admin', 10);
    createUser(id, 'admin', hash, 'admin', [], null);
    console.log('  ⚠️  Utente admin creato con credenziali default: admin / admin');
    console.log('  ⚠️  CAMBIA LA PASSWORD APPENA POSSIBILE!\n');
  }
});
