/**
 * js/modules/quickNotes.js
 *
 * Gestione degli Appunti rapidi (tab "Appunti").
 * Funzionalità: aggiunta, eliminazione, conferma, filtro, rendering.
 *
 * Persistenza:
 *   I quickNotes non hanno uno store dedicato nel backend v2.
 *   Vengono salvati come setting JSON: db.setSetting('quickNotes', array).
 *   Questo li rende disponibili sia online (backend settings) che offline (IDB).
 *   TODO: aggiungere uno store 'quickNotes' a db.js e al backend per una
 *         gestione granulare (un record per nota, invece di un unico JSON blob).
 *
 * Dipendenze v2:
 *   - ../db.js        → db.setSetting, db.getSetting
 *   - ../state.js     → state.quickNotes, state.setQuickNotes
 *   - ../helpers.js   → escapeHtml, formatDateLocal
 */

import * as db    from '../db.js';
import * as state from '../state.js';
import { escapeHtml, formatDateLocal } from '../helpers.js';

// ─── Persistenza ──────────────────────────────────────────────────────────────

/** Salva l'array quickNotes corrente nello state come setting. */
async function _persist() {
    await db.setSetting('quickNotes', state.quickNotes);
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────

/**
 * Normalizza la stringa di tag separati da virgola.
 * Rimuove spazi, # iniziali, duplicati. Max 12 tag.
 */
function _normalizeTags(tagsInput) {
    if (!tagsInput) return [];
    return tagsInput
        .split(',')
        .map(tag => tag.trim().replace(/^#+/, '').toLowerCase())
        .filter(Boolean)
        .filter((tag, idx, arr) => arr.indexOf(tag) === idx)
        .slice(0, 12);
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

/** Imposta i valori di default della form (data oggi, ora 09:00). */
function ensureQuickNoteFormDefaults() {
    const dateEl = document.getElementById('quickNoteDate');
    const timeEl = document.getElementById('quickNoteTime');
    if (dateEl && !dateEl.value) dateEl.value = formatDateLocal(new Date());
    if (timeEl && !timeEl.value) timeEl.value = '09:00';
}

/** Pulisce tutti i campi della form e reimposta i default. */
export function clearQuickNoteForm() {
    const textEl = document.getElementById('quickNoteText');
    const dateEl = document.getElementById('quickNoteDate');
    const timeEl = document.getElementById('quickNoteTime');
    const tagsEl = document.getElementById('quickNoteTags');
    if (!textEl || !dateEl || !timeEl || !tagsEl) return;

    textEl.value = '';
    dateEl.value = formatDateLocal(new Date());
    timeEl.value = '09:00';
    tagsEl.value = '';
}

/** Aggiorna le opzioni della select filtro tag con i tag presenti. */
function _updateTagFilterOptions() {
    const select = document.getElementById('quickNoteFilterTag');
    if (!select) return;

    const currentValue = select.value;
    const tagsSet = new Set();
    state.quickNotes.forEach(note => {
        (note.tags || []).forEach(tag => {
            if (tag) tagsSet.add(tag.toLowerCase());
        });
    });

    select.innerHTML = '<option value="">Tutti i tag</option>';
    Array.from(tagsSet).sort().forEach(tag => {
        const option       = document.createElement('option');
        option.value       = tag;
        option.textContent = '#' + tag;
        select.appendChild(option);
    });

    if (currentValue && Array.from(select.options).some(opt => opt.value === currentValue)) {
        select.value = currentValue;
    }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Aggiunge un nuovo appunto leggendo i valori dalla form.
 * Valida i campi obbligatori, persiste, aggiorna UI.
 */
export async function addQuickNote() {
    const textEl = document.getElementById('quickNoteText');
    const dateEl = document.getElementById('quickNoteDate');
    const timeEl = document.getElementById('quickNoteTime');
    const tagsEl = document.getElementById('quickNoteTags');
    if (!textEl || !dateEl || !timeEl || !tagsEl) return;

    const text = textEl.value.trim();
    const date = dateEl.value;
    const time = timeEl.value;
    const tags = _normalizeTags(tagsEl.value);

    if (!text) {
        alert('Inserisci il testo dell\'appunto.');
        textEl.focus();
        return;
    }
    if (!date) {
        alert('Inserisci la data dell\'appunto.');
        dateEl.focus();
        return;
    }
    if (!time) {
        alert('Inserisci l\'orario dell\'appunto.');
        timeEl.focus();
        return;
    }

    const note = {
        id:        Date.now() + Math.random(),
        text:      text.substring(0, 200),
        date,
        time,
        tags,
        confirmed: false,
        createdAt: new Date().toISOString()
    };

    state.quickNotes.push(note);
    await _persist();
    clearQuickNoteForm();
    renderQuickNotes();
    // Notifica app.js di aggiornare la dashboard
    window.dispatchEvent(new CustomEvent('app:viewRefresh', { detail: { views: ['dashboard'] } }));
}

/**
 * Elimina un appunto per id.
 * @param {number} noteId - id dell'appunto (numerico)
 */
export async function deleteQuickNote(noteId) {
    if (!confirm('Eliminare questo appunto?')) return;
    state.setQuickNotes(state.quickNotes.filter(note => note.id !== noteId));
    await _persist();
    renderQuickNotes();
    window.dispatchEvent(new CustomEvent('app:viewRefresh', { detail: { views: ['dashboard'] } }));
}

/**
 * Aggiorna il flag "confirmed" di un appunto.
 * @param {number} noteId  - id dell'appunto
 * @param {boolean} checked - nuovo valore del checkbox
 */
export async function toggleQuickNoteConfirmed(noteId, checked) {
    const note = state.quickNotes.find(item => item.id === noteId);
    if (!note) return;
    note.confirmed = !!checked;
    await _persist();
    renderQuickNotes();
    window.dispatchEvent(new CustomEvent('app:viewRefresh', { detail: { views: ['dashboard'] } }));
}

// ─── Formattazione ────────────────────────────────────────────────────────────

/**
 * Formatta data + ora per la visualizzazione in tabella.
 * @param {string} date - "YYYY-MM-DD"
 * @param {string} time - "HH:MM"
 * @returns {string} "DD/MM/YYYY HH:MM"
 */
function _formatDateTime(date, time) {
    const rawDate = date || formatDateLocal(new Date());
    const rawTime = time || '00:00';
    const formattedDate = new Date(rawDate + 'T00:00:00').toLocaleDateString('it-IT', {
        day:   '2-digit',
        month: '2-digit',
        year:  'numeric'
    });
    return `${formattedDate} ${rawTime}`;
}

// ─── Dashboard helper ─────────────────────────────────────────────────────────

/**
 * Ritorna gli appunti rilevanti per la dashboard (oggi e scaduti non confermati).
 * Ordinati per data+ora crescente.
 */
export function getQuickNotesForDashboard() {
    const todayStr = formatDateLocal(new Date());
    return state.quickNotes
        .slice()
        .sort((a, b) => {
            const keyA = `${a.date || ''} ${a.time || ''}`;
            const keyB = `${b.date || ''} ${b.time || ''}`;
            return keyA.localeCompare(keyB);
        })
        .filter(note => {
            if (!note.date) return false;
            return note.date === todayStr || (!note.confirmed && note.date < todayStr);
        });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Renderizza la tabella degli appunti con i filtri attivi.
 * Aggiorna anche il contatore e le opzioni del filtro tag.
 */
export function renderQuickNotes() {
    ensureQuickNoteFormDefaults();
    _updateTagFilterOptions();

    const tbody = document.querySelector('#quickNotesTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filterStatus = document.getElementById('quickNoteFilterStatus')?.value || 'all';
    const filterTag    = (document.getElementById('quickNoteFilterTag')?.value || '').toLowerCase();
    const filterText   = (document.getElementById('quickNoteFilterText')?.value || '').toLowerCase();

    let filtered = state.quickNotes.slice();

    if (filterStatus === 'pending') {
        filtered = filtered.filter(note => !note.confirmed);
    } else if (filterStatus === 'confirmed') {
        filtered = filtered.filter(note => !!note.confirmed);
    }
    if (filterTag) {
        filtered = filtered.filter(note => (note.tags || []).some(tag => tag.toLowerCase() === filterTag));
    }
    if (filterText) {
        filtered = filtered.filter(note => (note.text || '').toLowerCase().includes(filterText));
    }

    filtered.sort((a, b) => {
        const keyA = `${a.date || ''} ${a.time || ''}`;
        const keyB = `${b.date || ''} ${b.time || ''}`;
        return keyA.localeCompare(keyB);
    });

    const todayStr = formatDateLocal(new Date());

    filtered.forEach(note => {
        const tr = document.createElement('tr');
        if (!note.confirmed && note.date && note.date < todayStr) {
            tr.style.backgroundColor = 'rgba(244, 67, 54, 0.08)';
        }

        const tagsHtml = (note.tags && note.tags.length > 0)
            ? note.tags.map(tag => `<span class="dashboard-badge info" style="margin-right:4px;">#${escapeHtml(tag)}</span>`).join('')
            : '<span style="color:var(--text-tertiary);">-</span>';

        const statusHtml = note.confirmed
            ? '<span class="dashboard-badge success">Confermato</span>'
            : '<span class="dashboard-badge warning">Da confermare</span>';

        tr.innerHTML = `
            <td style="text-align:center;">
                <input type="checkbox" ${note.confirmed ? 'checked' : ''}
                    onchange="quickNotes.toggleQuickNoteConfirmed(${note.id}, this.checked)"
                    title="Conferma appunto" style="cursor:pointer;">
            </td>
            <td>${_formatDateTime(note.date, note.time)}</td>
            <td>${escapeHtml(note.text || '')}</td>
            <td>${tagsHtml}</td>
            <td>${statusHtml}</td>
            <td class="action-buttons">
                <button onclick="quickNotes.deleteQuickNote(${note.id})" class="secondary" title="Elimina appunto">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Contatore risultati
    const countMsg = filtered.length === state.quickNotes.length
        ? `Trovati ${filtered.length} appunti`
        : `Mostrati ${filtered.length} di ${state.quickNotes.length} appunti`;

    const existingCount = document.querySelector('#quickNotes .quick-notes-count');
    if (existingCount) {
        existingCount.textContent = countMsg;
    } else {
        const countDiv       = document.createElement('div');
        countDiv.className   = 'quick-notes-count';
        countDiv.style.cssText = 'margin-bottom:10px; color:var(--text-secondary); font-style:italic;';
        countDiv.textContent = countMsg;
        const table = document.getElementById('quickNotesTable');
        if (table) table.parentNode.insertBefore(countDiv, table);
    }
}
