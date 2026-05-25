/**
 * js/modules/annotations.js
 *
 * Vista "Annotazioni": raccoglie e mostra tutte le attività dei progetti
 * che hanno il campo `task.annotation` non vuoto.
 *
 * Non esiste un modal separato per le annotazioni: sono un campo del task
 * (`task.annotation`). La vista offre solo lettura + filtri + apertura task.
 *
 * Dipendenze v2:
 *   - ../state.js    → state.projects
 *   - ../helpers.js  → escapeHtml, formatDateLocal
 *
 * Per aprire il task modal senza dipendenza circolare su tasks.js, viene
 * dispatchiato il CustomEvent 'app:openTask' con { taskId, projectId }.
 * app.js deve ascoltarlo e chiamare openTaskModal().
 */

import * as state from '../state.js';
import { escapeHtml, formatDateLocal } from '../helpers.js';

// ─── Rendering ────────────────────────────────────────────────────────────────

/** Renderizza la tabella delle annotazioni con i filtri attivi. */
export function renderAnnotations() {
    const tbody = document.querySelector('#annotationsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filterClient = (document.getElementById('annotationsFilterClient')?.value || '').toLowerCase();
    const filterCode   = (document.getElementById('annotationsFilterCode')?.value   || '').toLowerCase();
    const filterText   = (document.getElementById('annotationsFilterText')?.value   || '').toLowerCase();

    // Raccogli tutte le attività con annotazione non vuota
    const annotatedTasks = [];
    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (task.annotation && task.annotation.trim()) {
                annotatedTasks.push({ project, task });
            }
        });
    });

    // Applica filtri
    let filtered = annotatedTasks;
    if (filterClient) {
        filtered = filtered.filter(item => (item.project.client || '').toLowerCase().includes(filterClient));
    }
    if (filterCode) {
        filtered = filtered.filter(item => (item.project.code || '').toLowerCase().includes(filterCode));
    }
    if (filterText) {
        filtered = filtered.filter(item => (item.task.annotation || '').toLowerCase().includes(filterText));
    }

    // Ordina per data di inizio (più vecchia/urgente in alto), senza data in fondo
    filtered.sort((a, b) => {
        const dateA = a.task.startDate || '';
        const dateB = b.task.startDate || '';
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA.localeCompare(dateB);
    });

    // Renderizza righe
    const today = formatDateLocal(new Date());
    filtered.forEach(({ project, task }) => {
        const tr = document.createElement('tr');

        // Evidenzia attività con data passata
        if (task.startDate && task.startDate < today) {
            tr.style.backgroundColor = 'rgba(244, 67, 54, 0.06)';
        }

        const startDateFormatted = task.startDate
            ? new Date(task.startDate + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '<span style="color:var(--text-tertiary); font-style:italic;">Non definita</span>';

        tr.innerHTML = `
            <td>${escapeHtml(project.client || '')}</td>
            <td>${escapeHtml(project.code || '')}</td>
            <td>${escapeHtml(project.description || '-')}</td>
            <td>${escapeHtml(task.name || '')}</td>
            <td>${startDateFormatted}</td>
            <td style="max-width: 350px;"><span title="${escapeHtml(task.annotation)}">${escapeHtml(task.annotation)}</span></td>
            <td class="action-buttons">
                <button onclick="openTaskFromAnnotations(${task.id}, ${project.id})" class="secondary" title="Modifica attività">✏️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Contatore risultati
    const countMsg = filtered.length === annotatedTasks.length
        ? `Trovate ${filtered.length} annotazioni`
        : `Mostrate ${filtered.length} di ${annotatedTasks.length} annotazioni`;

    const existingCount = document.querySelector('#annotations .annotations-count');
    if (existingCount) {
        existingCount.textContent = countMsg;
    } else {
        const countDiv        = document.createElement('div');
        countDiv.className    = 'annotations-count';
        countDiv.style.cssText = 'margin-bottom: 10px; color: var(--text-secondary); font-style: italic;';
        countDiv.textContent   = countMsg;
        const table = document.getElementById('annotationsTable');
        if (table) table.parentNode.insertBefore(countDiv, table);
    }
}

// ─── Azioni ───────────────────────────────────────────────────────────────────

/**
 * Apre il modal task per modificare l'attività che contiene l'annotazione.
 * Dispatcha 'app:openTask' per evitare dipendenza circolare su tasks.js.
 */
export function openTaskFromAnnotations(taskId, projectId) {
    window.dispatchEvent(new CustomEvent('app:openTask', { detail: { taskId, projectId } }));
}
