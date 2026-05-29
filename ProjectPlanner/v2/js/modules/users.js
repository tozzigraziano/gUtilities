/**
 * js/modules/users.js  –  Gestione utenti (admin only)
 *
 * Modale per creare, modificare ed eliminare utenti.
 * Per gli editor è possibile configurare i tipi di risorsa gestibili.
 */

import * as state from '../state.js';
import { API_BASE } from '../db.js';

// ─── Costanti ─────────────────────────────────────────────────────────────────

const ROLE_LABELS = {
  admin:    '🔑 Admin',
  editor:   '✏️ Editor',
  viewer:   '👁 Visualizzatore',
  personal: '👤 Personale'
};

let _editingUserId = null;

// ─── API helpers ──────────────────────────────────────────────────────────────

function _authHeader() {
  const token = localStorage.getItem('pp2_auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function _apiFetch(path, method = 'GET', body) {
  const headers = { ..._authHeader() };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ─── Gestione modale ──────────────────────────────────────────────────────────

export function openUsersModal() {
  _editingUserId = null;
  _resetUserForm();
  _loadAndRenderUsers();
  const modal = document.getElementById('usersModal');
  if (modal) modal.style.display = 'flex';
}

export function closeUsersModal() {
  const modal = document.getElementById('usersModal');
  if (modal) modal.style.display = 'none';
}

// ─── Rendering lista utenti ───────────────────────────────────────────────────

async function _loadAndRenderUsers() {
  try {
    const users = await _apiFetch('/users');
    _renderUsersList(users);
  } catch (e) {
    const c = document.getElementById('usersListContainer');
    if (c) c.innerHTML = `<p style="color:var(--error,#f44)">Errore: ${_esc(e.message)}</p>`;
  }
}

function _renderUsersList(users) {
  const container = document.getElementById('usersListContainer');
  if (!container) return;

  if (!users.length) {
    container.innerHTML = '<p><em>Nessun utente trovato.</em></p>';
    return;
  }

  let html = `<table class="data-table" style="margin-bottom:20px;width:100%">
    <thead><tr>
      <th>Username</th><th>Ruolo</th><th>Stato</th><th style="width:80px">Azioni</th>
    </tr></thead><tbody>`;

  for (const u of users) {
    html += `<tr>
      <td>${_esc(u.username)}</td>
      <td><span class="role-badge role-${u.role}">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td>${u.is_active ? '✅ Attivo' : '❌ Disattivato'}</td>
      <td>
        <button onclick="editUser('${u.id}')" class="btn-small" title="Modifica">✏️</button>
        <button onclick="deleteUser('${u.id}')" class="btn-small secondary" title="Elimina">🗑️</button>
      </td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ─── Form utente ──────────────────────────────────────────────────────────────

function _resetUserForm() {
  _editingUserId = null;
  const title = document.getElementById('userFormTitle');
  if (title) title.textContent = 'Nuovo Utente';
  _setField('editUserId', '');
  _setField('userUsername', '');
  _setField('userPassword', '');
  const passEl = document.getElementById('userPassword');
  if (passEl) passEl.placeholder = 'Password';
  _setField('userRole', 'viewer');
  const active = document.getElementById('userIsActive');
  if (active) active.checked = true;
  _populateEditorResourceTypes([]);
  _populateResourceSelect('');
  updateUserFormForRole();
}

/** Aggiorna la visibilità delle sezioni nel form in base al ruolo selezionato. */
export function updateUserFormForRole() {
  const role    = document.getElementById('userRole')?.value;
  const edSec   = document.getElementById('editorResourceTypesSection');
  const persSec = document.getElementById('personalResourceSection');
  if (edSec)   edSec.style.display   = role === 'editor'   ? '' : 'none';
  if (persSec) persSec.style.display = role === 'personal' ? '' : 'none';
}

function _populateEditorResourceTypes(allowedTypes = []) {
  const container = document.getElementById('editorResourceTypesList');
  if (!container) return;
  const types = state.resourceTypes || [];
  if (!types.length) {
    container.innerHTML = '<em style="font-size:0.85em">Nessun tipo risorsa configurato nelle impostazioni.</em>';
    return;
  }
  container.innerHTML = types.map(rt => `
    <label class="checkbox-label">
      <input type="checkbox" value="${_esc(rt.value)}" ${allowedTypes.includes(rt.value) ? 'checked' : ''}>
      ${_esc(rt.label || rt.value)}
    </label>`).join('');
}

function _populateResourceSelect(selectedId = '') {
  const sel = document.getElementById('userResourceId');
  if (!sel) return;
  let html = '<option value="">-- Nessuna risorsa collegata --</option>';
  for (const r of (state.resources || [])) {
    const name = `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.id;
    html += `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${_esc(name)}</option>`;
  }
  sel.innerHTML = html;
}

// ─── Carica utente per modifica ───────────────────────────────────────────────

export async function editUser(userId) {
  try {
    const users = await _apiFetch('/users');
    const u = users.find(x => x.id === userId);
    if (!u) return;

    _editingUserId = userId;
    const title = document.getElementById('userFormTitle');
    if (title) title.textContent = 'Modifica Utente';

    _setField('editUserId', u.id);
    _setField('userUsername', u.username);
    _setField('userPassword', '');
    const passEl = document.getElementById('userPassword');
    if (passEl) passEl.placeholder = 'Lascia vuoto per non cambiare';
    _setField('userRole', u.role);
    const active = document.getElementById('userIsActive');
    if (active) active.checked = !!u.is_active;

    _populateEditorResourceTypes(u.allowed_resource_types || []);
    _populateResourceSelect(u.resource_id || '');
    updateUserFormForRole();
  } catch (e) {
    alert('Errore nel caricamento utente: ' + e.message);
  }
}

// ─── Salva utente (crea o aggiorna) ──────────────────────────────────────────

export async function saveUser() {
  const username = document.getElementById('userUsername')?.value?.trim();
  const password = document.getElementById('userPassword')?.value;
  const role     = document.getElementById('userRole')?.value;
  const isActive = document.getElementById('userIsActive')?.checked ?? true;

  if (!username) { alert('Username obbligatorio'); return; }
  if (!_editingUserId && !password) { alert('Password obbligatoria per un nuovo utente'); return; }

  // Tipi risorsa selezionati (solo per editor)
  const allowedResourceTypes = [];
  document.querySelectorAll('#editorResourceTypesList input[type=checkbox]:checked')
    .forEach(cb => allowedResourceTypes.push(cb.value));

  const resourceId = document.getElementById('userResourceId')?.value || null;

  const body = { username, role, allowedResourceTypes, resourceId, isActive };
  if (!_editingUserId) {
    body.password = password;
  } else if (password) {
    body.newPassword = password;
  }

  try {
    if (_editingUserId) {
      await _apiFetch(`/users/${_editingUserId}`, 'PUT', body);
    } else {
      await _apiFetch('/users', 'POST', body);
    }
    _resetUserForm();
    _loadAndRenderUsers();
  } catch (e) {
    alert('Errore: ' + e.message);
  }
}

// ─── Elimina utente ───────────────────────────────────────────────────────────

export async function deleteUser(userId) {
  if (!confirm('Eliminare questo utente definitivamente?')) return;
  try {
    await _apiFetch(`/users/${userId}`, 'DELETE');
    _loadAndRenderUsers();
  } catch (e) {
    alert('Errore: ' + e.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}
