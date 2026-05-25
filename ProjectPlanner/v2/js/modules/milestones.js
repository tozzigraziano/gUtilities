/**
 * js/modules/milestones.js
 *
 * Gestione milestone (punti di controllo) di progetto: CRUD e rendering.
 * Le milestone sono embedded dentro i progetti (project.milestones[]).
 *
 * Dipendenze v2:
 *   - ../db.js           → db.save  (salva l'intero progetto aggiornato)
 *   - ../state.js        → state.projects, state.currentProjectId,
 *                          state.editingMilestoneId, state.setEditingMilestoneId
 *   - ../helpers.js      → openModal, closeModal
 *   - ./holidays.js      → calculateHolidays, renderHolidays
 *
 * Per evitare dipendenze circolari, renderGantt e applyTaskLinks vengono
 * richiesti tramite CustomEvent 'app:viewRefresh'.
 */

import * as db    from '../db.js';
import * as state from '../state.js';
import { openModal, closeModal } from '../helpers.js';
import { calculateHolidays, renderHolidays } from './holidays.js';

// ─── Helper interno ───────────────────────────────────────────────────────────

/**
 * Notifica app.js di aggiornare le viste dipendenti.
 * @param {string[]} views
 */
function _triggerViewRefresh(views = []) {
    window.dispatchEvent(new CustomEvent('app:viewRefresh', { detail: { views } }));
}

// ─── Modal Milestone ──────────────────────────────────────────────────────────

/** Apre il modal per creare o modificare una milestone. */
export function openMilestoneModal(id = null) {
    state.setEditingMilestoneId(id);
    const modal = document.getElementById('milestoneModal');
    const title = document.getElementById('milestoneModalTitle');

    if (id) {
        title.textContent = 'Modifica Punto di Controllo';
        const project = state.projects.find(p => p.id === state.currentProjectId);
        if (project) {
            const milestone = (project.milestones || []).find(m => m.id === id);
            if (milestone) {
                document.getElementById('milestoneName').value = milestone.name;
                document.getElementById('milestoneDate').value = milestone.date;
            }
        }
    } else {
        title.textContent = 'Nuovo Punto di Controllo';
        clearMilestoneForm();
    }

    openModal(modal);
}

/** Chiude il modal milestone e azzera il form. */
export function closeMilestoneModal() {
    closeModal(document.getElementById('milestoneModal'));
    clearMilestoneForm();
}

/** Azzera i campi del form milestone. */
export function clearMilestoneForm() {
    state.setEditingMilestoneId(null);
    document.getElementById('milestoneName').value = '';
    document.getElementById('milestoneDate').value = '';
}

// ─── CRUD Milestone ───────────────────────────────────────────────────────────

/** Salva (crea o aggiorna) una milestone nel progetto corrente. */
export async function saveMilestone() {
    const name = document.getElementById('milestoneName').value.trim();
    const date = document.getElementById('milestoneDate').value;

    if (!name || !date) {
        alert('Nome e Data sono obbligatori');
        return;
    }

    const project = state.projects.find(p => p.id === state.currentProjectId);
    if (!project) return;

    if (!project.milestones) project.milestones = [];

    const milestone = {
        id:   state.editingMilestoneId || Date.now(),
        name,
        date
    };

    if (state.editingMilestoneId) {
        const index = project.milestones.findIndex(m => m.id === state.editingMilestoneId);
        if (index !== -1) {
            project.milestones[index] = milestone;
        } else {
            project.milestones.push(milestone);
        }
    } else {
        project.milestones.push(milestone);
    }

    await db.save('projects', project);
    calculateHolidays();
    renderHolidays();
    renderMilestones();
    closeMilestoneModal();

    // Richiede a app.js di aggiornare gantt e applicare collegamenti attività
    _triggerViewRefresh(['gantt', 'taskLinks']);
}

/** Elimina una milestone dal progetto corrente. */
export async function deleteMilestone(id) {
    if (!confirm('Sei sicuro di voler eliminare questo punto di controllo?')) return;

    const project = state.projects.find(p => p.id === state.currentProjectId);
    if (!project) return;

    project.milestones = (project.milestones || []).filter(m => m.id !== id);
    await db.save('projects', project);
    renderMilestones();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/** Renderizza la tabella milestone del progetto corrente. */
export function renderMilestones() {
    const project = state.projects.find(p => p.id === state.currentProjectId);
    if (!project) return;

    const tbody = document.querySelector('#milestonesTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!project.milestones) project.milestones = [];

    // Ordina per data
    const sorted = [...project.milestones].sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
    });

    sorted.forEach(milestone => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${milestone.name}</td>
            <td>${milestone.date}</td>
            <td class="action-buttons">
                <button onclick="openMilestoneModal(${milestone.id})" class="secondary">✏️ Modifica</button>
                <button onclick="deleteMilestone(${milestone.id})" class="delete">🗑️ Elimina</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}
