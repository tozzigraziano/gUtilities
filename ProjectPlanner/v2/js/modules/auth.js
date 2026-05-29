/**
 * js/modules/auth.js  –  Gestione autenticazione utente
 *
 * Responsabilità:
 *  - Gestione token JWT (localStorage)
 *  - Login / Logout
 *  - Verifica ruolo corrente
 *  - Mostra/nascondi login overlay e indicatore utente in navbar
 */

// ─── Costanti ─────────────────────────────────────────────────────────────────

const TOKEN_KEY   = 'pp2_auth_token';
const API_AUTH    = `${window.location.protocol}//${window.location.hostname}:3001/api/auth`;

// ─── Token helpers ────────────────────────────────────────────────────────────

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Decodifica il payload del JWT senza verifica firma (solo frontend). */
function _decodePayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** Ritorna i dati dell'utente corrente dal token in localStorage, o null. */
export function getCurrentUser() {
  const token = getToken();
  if (!token) return null;
  const payload = _decodePayload(token);
  if (!payload) return null;
  // Controlla scadenza
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    clearToken();
    return null;
  }
  return payload;
}

export function isAuthenticated() {
  return !!getCurrentUser();
}

/** Ritorna true se l'utente ha uno dei ruoli indicati. */
export function hasRole(...roles) {
  const user = getCurrentUser();
  return user ? roles.includes(user.role) : false;
}

/** Ritorna true se può eseguire operazioni di scrittura (admin o editor). */
export function canWrite() {
  return hasRole('admin', 'editor');
}

// ─── Login / Logout ───────────────────────────────────────────────────────────

/**
 * Invia le credenziali al backend e memorizza il token.
 * Ritorna l'oggetto utente in caso di successo.
 * Lancia Error in caso di fallimento.
 */
export async function login(username, password) {
  const res = await fetch(`${API_AUTH}/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login fallito');
  setToken(data.token);
  return data.user;
}

export function logout() {
  clearToken();
  showLoginOverlay();
}

// ─── Change password ──────────────────────────────────────────────────────────

export async function changePassword(currentPassword, newPassword) {
  const token = getToken();
  const res = await fetch(`${API_AUTH}/change-password`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ currentPassword, newPassword })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Errore cambio password');
  return true;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

const ROLE_LABELS = {
  admin:    '🔑 Admin',
  editor:   '✏️ Editor',
  viewer:   '👁 Visualizzatore',
  personal: '👤 Personale'
};

/** Mostra l'overlay di login e nasconde l'app. */
export function showLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  const app     = document.querySelector('.container');
  if (overlay) overlay.style.display = 'flex';
  if (app)     app.style.display     = 'none';
  // Reset form
  const userEl = document.getElementById('loginUsername');
  const passEl = document.getElementById('loginPassword');
  const errEl  = document.getElementById('loginError');
  if (userEl) userEl.value = '';
  if (passEl) passEl.value = '';
  if (errEl)  { errEl.textContent = ''; errEl.style.display = 'none'; }
}

/** Nasconde l'overlay di login e mostra l'app. */
export function hideLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  const app     = document.querySelector('.container');
  if (overlay) overlay.style.display = 'none';
  if (app)     app.style.display     = '';
}

/** Aggiorna la navbar con username, badge ruolo e pulsanti contestuali. */
export function updateAuthBar() {
  const user     = getCurrentUser();
  const nameEl   = document.getElementById('authUsername');
  const badgeEl  = document.getElementById('authRoleBadge');
  const adminBtn = document.getElementById('btnGestisciUtenti');

  if (!user) return;
  if (nameEl)   nameEl.textContent   = user.username;
  if (badgeEl)  {
    badgeEl.textContent  = ROLE_LABELS[user.role] || user.role;
    badgeEl.className    = `role-badge role-${user.role}`;
  }
  if (adminBtn) adminBtn.style.display = user.role === 'admin' ? '' : 'none';
}

// ─── Login form handler (esposto a window da app.js) ─────────────────────────

export async function doLogin() {
  const username = document.getElementById('loginUsername')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');

  if (!username || !password) {
    if (errEl) { errEl.textContent = 'Inserisci username e password.'; errEl.style.display = ''; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Accesso in corso…'; }
  if (errEl) errEl.style.display = 'none';

  try {
    await login(username, password);
    hideLoginOverlay();
    updateAuthBar();
    // Notifica app.js di procedere con il caricamento dati
    window.dispatchEvent(new CustomEvent('auth:loggedIn'));
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Accedi'; }
  }
}

// ─── Change password form handler ─────────────────────────────────────────────

export function openChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (!modal) return;
  document.getElementById('cpCurrentPassword').value = '';
  document.getElementById('cpNewPassword').value     = '';
  document.getElementById('cpConfirmPassword').value = '';
  document.getElementById('cpError').style.display   = 'none';
  modal.style.display = 'flex';
}

export function closeChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.style.display = 'none';
}

export async function doChangePassword() {
  const current  = document.getElementById('cpCurrentPassword')?.value;
  const next     = document.getElementById('cpNewPassword')?.value;
  const confirm  = document.getElementById('cpConfirmPassword')?.value;
  const errEl    = document.getElementById('cpError');

  if (!current || !next || !confirm) {
    errEl.textContent = 'Compila tutti i campi.'; errEl.style.display = ''; return;
  }
  if (next !== confirm) {
    errEl.textContent = 'Le nuove password non coincidono.'; errEl.style.display = ''; return;
  }
  if (next.length < 4) {
    errEl.textContent = 'Password troppo breve (min 4 caratteri).'; errEl.style.display = ''; return;
  }

  try {
    await changePassword(current, next);
    closeChangePasswordModal();
    alert('Password cambiata con successo!');
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = '';
  }
}
