/**
 * js/modules/bacheca.js
 *
 * Kanban board (tab "Bacheca"): rendering delle colonne per stato, card attività,
 * spostamento task tra colonne.
 *
 * Dipendenze v2:
 *   - ../db.js       → db.save
 *   - ../state.js    → projects, resources, plants, setCurrentProjectId
 *   - ../helpers.js  → escapeHtml, formatDateLocal, getLocationBadgeHtml,
 *                      calculateEndDateForTask
 *
 * Funzioni esposte su window da app.js:
 *   window.renderBacheca        = Bacheca.renderBacheca
 *   window.moveTask             = Bacheca.moveTask
 *   window.openTaskFromBacheca  = Bacheca.openTaskFromBacheca
 */

import * as db    from '../db.js';
import * as state from '../state.js';
import {
    escapeHtml,
    formatDateLocal,
    getLocationBadgeHtml,
    calculateEndDateForTask
} from '../helpers.js';

// ─── Helper privati ───────────────────────────────────────────────────────────

/**
 * Aggiorna gli stati delle attività in base alle date (in-ritardo se scadute).
 * Modifica direttamente i task in state.projects.
 * Ritorna l'array dei progetti modificati per permettere la persistenza selettiva.
 */
function updateTaskStatusBasedOnDates() {
    const today        = formatDateLocal(new Date());
    const modifiedIds  = new Set();

    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (task.status !== 'in-corso' && task.status !== 'nessuno' && task.status !== '') return;
            if (task.endDate && task.endDate < today && task.completion < 100) {
                task.status = 'in-ritardo';
                modifiedIds.add(project.id);
            }
        });
    });

    return state.projects.filter(p => modifiedIds.has(p.id));
}

/**
 * Rileva le attività che hanno subito ritardi a causa di assenze delle risorse.
 * Confronta la data di fine teorica (senza assenze) con quella effettiva (con assenze).
 */
function findTasksWithAbsenceDelays() {
    const tasksWithDelays = [];

    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (task.status === 'completata') return;
            if (!task.resources || task.resources.length === 0) return;
            if (!task.startDate || !task.duration) return;

            const endWithout = calculateEndDateForTask(
                task.startDate, task.duration,
                task.saturdayWork, task.sundayWork, task.holidayWork,
                []
            );
            const endWith = calculateEndDateForTask(
                task.startDate, task.duration,
                task.saturdayWork, task.sundayWork, task.holidayWork,
                task.resources
            );

            if (endWithout !== endWith) {
                const delayDays = Math.round(
                    (new Date(endWith) - new Date(endWithout)) / (1000 * 60 * 60 * 24)
                );
                if (delayDays > 0) {
                    tasksWithDelays.push({
                        project,
                        task,
                        delayDays,
                        affectedResources: task.resources.map(tr => {
                            const r = state.resources.find(res => res.id == tr.resourceId);
                            return r ? `${r.firstName} ${r.lastName}` : 'Sconosciuta';
                        }).join(', ')
                    });
                }
            }
        });
    });

    return tasksWithDelays;
}

/**
 * Ritorna true se il task dovrebbe essere in corso in base alle date.
 */
function shouldBeInProgress(task) {
    if (!task.startDate) return false;
    const today     = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(task.startDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate   = task.endDate ? new Date(task.endDate) : null;
    if (endDate) endDate.setHours(0, 0, 0, 0);
    return startDate <= today && (!endDate || endDate >= today);
}

/**
 * Crea il DOM element della card Kanban per un task.
 */
function createBachecaCard(task, project, delayInfo) {
    const card    = document.createElement('div');
    card.className = 'bacheca-card';
    card.onclick   = () => openTaskFromBacheca(task.id, project.id);

    // Risorse
    let resourcesStr = 'Nessuna risorsa';
    if (task.resources && task.resources.length > 0) {
        resourcesStr = task.resources.map(r => {
            const resource = state.resources.find(res => res.id == r.resourceId);
            return resource ? `${resource.firstName} ${resource.lastName}` : '';
        }).filter(s => s).join(', ');
    }

    // Indicatore ritardo da assenze
    const delayIndicator = delayInfo
        ? `<span style="color: #ff6b6b; font-weight: bold;"> ⚠️ +${delayInfo.delayDays}gg</span>`
        : '';

    // Indicatore note
    const notesIndicator = task.notes && task.notes.trim()
        ? `<span style="color: var(--warning-color); margin-left: 5px; cursor: help;" title="${task.notes.replace(/"/g, '&quot;').replace(/\n/g, '&#10;')}">📝</span>`
        : '';

    // Barra avanzamento
    let progressBarHTML = '';
    const actualCompletion = task.completion || 0;

    if (task.status === 'in-corso' && task.startDate && task.endDate) {
        const today     = new Date();
        today.setHours(0, 0, 0, 0);
        const startDate = new Date(task.startDate);
        startDate.setHours(0, 0, 0, 0);
        const endDate   = new Date(task.endDate);
        endDate.setHours(0, 0, 0, 0);

        const totalDays          = Math.max(1, (endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        const daysPassed         = Math.max(0, (today - startDate) / (1000 * 60 * 60 * 24));
        const expectedCompletion = Math.min(100, Math.max(0, (daysPassed / totalDays) * 100));
        const expectedEndOfToday = Math.min(100, Math.max(0, ((daysPassed + 1) / totalDays) * 100));
        const diff               = actualCompletion - expectedCompletion;

        const todayWorkHTML = (today <= endDate && daysPassed >= 0)
            ? `<div class="bacheca-progress-today" style="left: ${expectedCompletion}%; width: ${expectedEndOfToday - expectedCompletion}%;"></div>`
            : '';

        if (diff < -5) {
            progressBarHTML = `
                <div class="bacheca-progress-delay" style="width: ${expectedCompletion}%;"></div>
                <div class="bacheca-progress-actual" style="width: ${actualCompletion}%; border-radius: 10px;"></div>
                ${todayWorkHTML}
                <div class="bacheca-progress-expected" style="left: ${expectedCompletion}%;"></div>
                <div class="bacheca-progress-text">${actualCompletion}%</div>
            `;
        } else if (diff > 5) {
            progressBarHTML = `
                <div class="bacheca-progress-advance" style="width: ${actualCompletion}%;"></div>
                ${todayWorkHTML}
                <div class="bacheca-progress-expected" style="left: ${expectedCompletion}%;"></div>
                <div class="bacheca-progress-text">${actualCompletion}%</div>
            `;
        } else {
            progressBarHTML = `
                <div class="bacheca-progress-actual" style="width: ${actualCompletion}%; border-radius: 10px;"></div>
                ${todayWorkHTML}
                <div class="bacheca-progress-expected" style="left: ${expectedCompletion}%;"></div>
                <div class="bacheca-progress-text">${actualCompletion}%</div>
            `;
        }
    } else {
        progressBarHTML = `
            <div class="bacheca-progress-actual" style="width: ${actualCompletion}%; border-radius: 10px;"></div>
            <div class="bacheca-progress-text">${actualCompletion}%</div>
        `;
    }

    card.innerHTML = `
        <div class="bacheca-card-title">${escapeHtml(task.name)}${delayIndicator}${notesIndicator}</div>
        <div class="bacheca-card-project">📁 ${escapeHtml(project.client)} - ${escapeHtml(project.code)}</div>
        <div class="bacheca-card-info">
            <div class="bacheca-card-dates">
                <span>📅 ${task.startDate || '-'}</span>
                <span>🏁 ${task.endDate || '-'}</span>
            </div>
            <div class="bacheca-card-resources">👤 ${escapeHtml(resourcesStr)}</div>
            <div>${getLocationBadgeHtml(task)}</div>
            <div class="bacheca-progress-bar">
                ${progressBarHTML}
            </div>
        </div>
    `;

    return card;
}

// ─── Navigazione ──────────────────────────────────────────────────────────────

/** Imposta il progetto corrente e apre il modal del task. */
export function openTaskFromBacheca(taskId, projectId) {
    state.setCurrentProjectId(projectId);
    if (typeof window.openTaskModal === 'function') {
        window.openTaskModal(taskId);
    }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/** Renderizza la Kanban board nel contenitore #bachecaContainer. */
export async function renderBacheca() {
    const container = document.getElementById('bachecaContainer');
    if (!container) return;
    container.innerHTML = '';

    // Aggiorna stati basati sulle date e persiste i progetti modificati
    const modifiedProjects = updateTaskStatusBasedOnDates();
    for (const project of modifiedProjects) {
        await db.save('projects', project);
    }

    const tasksWithDelays = findTasksWithAbsenceDelays();

    // Raccogli tutte le attività non completate da tutti i progetti
    const allTasks = [];
    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (task.status === 'completata' || task.completion >= 100) return;
            allTasks.push({
                task,
                project,
                delay: tasksWithDelays.find(td => td.task.id === task.id)
            });
        });
    });

    // Colonne Kanban
    const columns = [
        { id: 'in-ritardo',    title: '🚨 In Ritardo',    status: 'in-ritardo'  },
        { id: 'da-avviare',    title: '⚠️ Da Avviare',    status: 'da-avviare'  },
        { id: 'in-corso',      title: '🔄 In Corso',       status: 'in-corso'    },
        { id: 'pausa',         title: '⏸️ In Pausa',       status: 'pausa'       },
        { id: 'non-assegnata', title: '📌 Non Assegnate',  status: 'nessuno'     },
        { id: 'annullata',     title: '❌ Annullate',      status: 'annullata'   }
    ];

    columns.forEach(column => {
        const columnDiv    = document.createElement('div');
        columnDiv.className = `bacheca-column ${column.id}`;

        const tasksInColumn = allTasks.filter(item => {
            if (column.status === 'da-avviare') {
                return (item.task.status === 'nessuno' || item.task.status === '' || !item.task.status)
                    && shouldBeInProgress(item.task);
            }
            if (column.status === 'nessuno') {
                const isUnstarted = item.task.status === 'nessuno'
                    || item.task.status === ''
                    || !item.task.status
                    || !item.task.resources
                    || item.task.resources.length === 0;
                return isUnstarted && !shouldBeInProgress(item.task);
            }
            return item.task.status === column.status;
        });

        const count = tasksInColumn.length;
        columnDiv.innerHTML = `<h3>${column.title} <span style="opacity: 0.6;">(${count})</span></h3>`;

        if (count === 0) {
            columnDiv.innerHTML += '<div class="bacheca-empty">Nessuna attività</div>';
        } else {
            tasksInColumn.forEach(item => {
                const card = createBachecaCard(item.task, item.project, item.delay);
                columnDiv.appendChild(card);
            });
        }

        container.appendChild(columnDiv);
    });
}

// ─── Spostamento task ─────────────────────────────────────────────────────────

/**
 * Sposta un task in un nuovo stato, persiste il progetto e riaggiorna la bacheca.
 * @param {number} taskId    - ID del task da spostare
 * @param {string} newStatus - Nuovo stato (es. 'in-corso', 'pausa', 'completata')
 */
export async function moveTask(taskId, newStatus) {
    const project = state.projects.find(
        p => p.tasks && p.tasks.some(t => t.id === taskId)
    );
    if (!project) return;

    const task = project.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.status = newStatus;
    await db.save('projects', project);
    await renderBacheca();
}
