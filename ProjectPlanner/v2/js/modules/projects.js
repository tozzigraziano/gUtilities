/**
 * js/modules/projects.js
 *
 * Gestione progetti: CRUD, dettaglio progetto, statistiche, aggiornamenti,
 * info generali, e propagazione dei link tra attività.
 *
 * Funzioni esportate:
 *   calculateProjectStats(project)        → statistiche completion/giorni
 *   renderProjectDaysSummary()            → riquadri giorni nel dettaglio
 *   showProjectsStatistics()              → dialog riepilogo globale
 *   renderProjects()                      → tabella progetti (tab Progetti)
 *   updateProjectSelects()                → popola <select> con lista progetti
 *   openProjectModal(id)                  → apre modal crea/modifica progetto
 *   closeProjectModal()                   → chiude modal progetto
 *   saveProject()                         → salva (crea o aggiorna) un progetto
 *   deleteProject(id)                     → elimina un progetto
 *   openProjectDetails(id)                → apre il pannello dettaglio progetto
 *   closeProjectDetails(restoreScroll)    → chiude il pannello dettaglio
 *   renderProjectGeneralInfo()            → popola textarea info generali
 *   saveProjectGeneralInfo()              → salva info generali
 *   renderProjectUpdates()                → tabella aggiornamenti del progetto
 *   addProjectUpdate()                    → aggiunge un aggiornamento
 *   deleteProjectUpdate(index)            → elimina un aggiornamento
 *   viewUpdate(index)                     → apre modal di lettura aggiornamento
 *   closeUpdateModal()                    → chiude modal visualizzazione aggiornamento
 *   applyTaskLinks()                      → propaga dipendenze start/end tra attività
 *   updateLinkedDates()                   → aggiorna campi data nel modal attività
 *
 * Dipendenze v2:
 *   - ../db.js         → db.save, db.remove
 *   - ../state.js      → state.projects, state.currentProjectId, state.resources,
 *                         state.templates, state.plants, state.selectedTasksForAnalysis
 *   - ../helpers.js    → openModal, closeModal, escapeHtml, formatDateLocal,
 *                         getAllUniqueClients, getResourceName, hoursToHHMM,
 *                         countWorkingDaysBetween, calculateEndDateForTask,
 *                         calculateStartDateForTask, calculateDateWithOffset
 *   - ./holidays.js    → calculateHolidays, renderHolidays
 *   - ./resources.js   → updateResourceSelects
 *   - ./warnings.js    → findTasksWithAbsenceDelays
 *   - ./milestones.js  → renderMilestones
 *   - ./offers.js      → renderProjectOffers, renderProjectIssues
 *   - ./meetings.js    → renderProjectMeetings
 *   - ./gantt.js       → renderGantt
 *
 * Pattern anti-circolarità:
 *   - renderTasks()          → window.renderTasks?.()
 *   - applyTemplateToProject → window.applyTemplateToProject?.(...)
 *   - showAbsenceWarning     → window.showAbsenceWarning?.(...)
 */

import * as db    from '../db.js';
import * as state from '../state.js';
import {
    openModal, closeModal,
    escapeHtml, formatDateLocal,
    getAllUniqueClients, getResourceName,
    hoursToHHMM, countWorkingDaysBetween,
    calculateEndDateForTask, calculateStartDateForTask, calculateDateWithOffset
} from '../helpers.js';
import { calculateHolidays, renderHolidays } from './holidays.js';
import { updateResourceSelects }             from './resources.js';
import { findTasksWithAbsenceDelays }        from './warnings.js';
import { renderMilestones }                  from './milestones.js';
import { renderProjectOffers, renderProjectIssues } from './offers.js';
import { renderProjectMeetings }             from './meetings.js';
import { renderGantt }                       from './gantt.js';

// ─── Stato locale ──────────────────────────────────────────────────────────────

/** Posizione di scroll salvata prima di aprire il dettaglio di un progetto. */
let _projectListScrollPosition = 0;

// ─── Helper interni ───────────────────────────────────────────────────────────

/** Ritorna il progetto correntemente aperto (dal state). */
function _currentProject() {
    return state.projects.find(p => p.id === state.currentProjectId) || null;
}

/** Notifica le viste dipendenti di aggiornarsi. */
function _triggerViewRefresh(views = []) {
    window.dispatchEvent(new CustomEvent('app:viewRefresh', { detail: { views } }));
}

// ─── Statistiche progetto ──────────────────────────────────────────────────────

/**
 * Calcola le statistiche di completamento di un progetto.
 * @param {Object} project
 * @returns {{ startDate, endDate, completion, remainingDays, totalDuration }}
 */
export function calculateProjectStats(project) {
    let startDate = null;
    let endDate   = null;
    let totalWeightedCompletion = 0;
    let totalDuration = 0;

    // Date dalle milestone
    if (project.milestones && project.milestones.length > 0) {
        project.milestones.forEach(m => {
            if (!startDate || m.date < startDate) startDate = m.date;
            if (!endDate   || m.date > endDate)   endDate   = m.date;
        });
    }

    // Date e pesi dalle attività
    if (project.tasks && project.tasks.length > 0) {
        project.tasks.forEach(task => {
            // Le attività annullate non contribuiscono al calcolo
            if (task.status === 'annullata') return;

            if (task.startDate) {
                if (!startDate || task.startDate < startDate) startDate = task.startDate;
            }
            if (task.endDate) {
                if (!endDate || task.endDate > endDate) endDate = task.endDate;
            }

            const duration   = parseInt(task.duration || 1);
            const completion = parseInt(task.completion || 0);
            const completedDays = (duration * completion) / 100;

            totalWeightedCompletion += completedDays;
            totalDuration           += duration;
        });
    }

    const completion    = totalDuration > 0 ? Math.round((totalWeightedCompletion / totalDuration) * 100) : 100;
    const remainingDays = totalDuration > 0 ? Math.round(totalDuration - totalWeightedCompletion) : 0;

    return { startDate, endDate, completion, remainingDays, totalDuration };
}

// ─── Riquadri giorni (dettaglio progetto) ─────────────────────────────────────

/**
 * Renderizza i badge con i totali giorni previsti/completati/rimasti/lavorati
 * nella sezione dettaglio di un progetto.
 */
export function renderProjectDaysSummary() {
    const project   = _currentProject();
    const container = document.getElementById('projectDaysSummary');
    if (!project || !container) return;

    const tasks = project.tasks || [];
    if (tasks.length === 0) {
        container.innerHTML = '';
        return;
    }

    const totalPlannedDays = tasks.reduce((sum, t) => sum + (parseInt(t.duration) || 0), 0);

    let totalWorkedDays      = 0;
    let totalActualCompleted = 0;
    const today = new Date();

    tasks.forEach(task => {
        if (task.startedAt) {
            if (task.completedAt) {
                totalActualCompleted += countWorkingDaysBetween(
                    task.startedAt, task.completedAt,
                    task.saturdayWork, task.sundayWork, task.holidayWork,
                    task.resources
                );
            } else {
                totalWorkedDays += countWorkingDaysBetween(
                    task.startedAt, formatDateLocal(today),
                    task.saturdayWork, task.sundayWork, task.holidayWork,
                    task.resources
                );
            }
        }
    });

    totalWorkedDays += totalActualCompleted;

    const remainingDays = tasks
        .filter(t => (parseInt(t.completion) || 0) < 100 && t.status !== 'completata' && t.status !== 'annullata')
        .reduce((sum, t) => sum + (parseInt(t.duration) || 0), 0);

    const completedPlannedDays = tasks
        .filter(t => (parseInt(t.completion) || 0) >= 100 || t.status === 'completata')
        .reduce((sum, t) => sum + (parseInt(t.duration) || 0), 0);

    const badgeStyle = 'padding: 8px 14px; border-radius: 6px; font-size: 0.9em; display: flex; flex-direction: column; align-items: center; min-width: 120px;';

    container.innerHTML = `
        <div style="${badgeStyle} background: var(--bg-tertiary); border: 1px solid var(--border-color);">
            <span style="font-size: 0.8em; color: var(--text-tertiary);">📋 Giorni Previsti</span>
            <strong style="font-size: 1.3em;">${totalPlannedDays}</strong>
        </div>
        <div style="${badgeStyle} background: var(--bg-tertiary); border: 1px solid var(--border-color);">
            <span style="font-size: 0.8em; color: var(--text-tertiary);">✅ Giorni Completati</span>
            <strong style="font-size: 1.3em; color: #4CAF50;">${completedPlannedDays}</strong>
        </div>
        <div style="${badgeStyle} background: var(--bg-tertiary); border: 1px solid var(--border-color);">
            <span style="font-size: 0.8em; color: var(--text-tertiary);">⏳ Giorni Rimasti</span>
            <strong style="font-size: 1.3em; color: #2196F3;">${remainingDays}</strong>
        </div>
        <div style="${badgeStyle} background: var(--bg-tertiary); border: 1px solid var(--border-color);">
            <span style="font-size: 0.8em; color: var(--text-tertiary);">⏱️ Giorni Lavorati</span>
            <strong style="font-size: 1.3em; color: ${totalWorkedDays > totalPlannedDays ? '#f44336' : '#ff9800'};">${totalWorkedDays}</strong>
        </div>
        ${totalActualCompleted > 0 ? `
        <div style="${badgeStyle} background: var(--bg-tertiary); border: 1px solid var(--border-color);">
            <span style="font-size: 0.8em; color: var(--text-tertiary);">📊 Scostamento</span>
            <strong style="font-size: 1.3em; color: ${totalActualCompleted > completedPlannedDays ? '#f44336' : '#4CAF50'};">${totalActualCompleted > completedPlannedDays ? '+' : ''}${totalActualCompleted - completedPlannedDays}gg</strong>
        </div>
        ` : ''}
    `;
}

// ─── Statistiche globali ──────────────────────────────────────────────────────

/** Mostra un dialog riepilogativo delle statistiche globali dei progetti. */
export function showProjectsStatistics() {
    let completedProjects  = 0;
    let openProjects       = 0;
    let totalRemainingDays = 0;

    state.projects.forEach(project => {
        const stats = calculateProjectStats(project);
        if (stats.completion >= 100) {
            completedProjects++;
        } else {
            openProjects++;
            totalRemainingDays += stats.remainingDays;
        }
    });

    const message =
        `📊 STATISTICHE GENERALI PROGETTI\n\n` +
        `📁 Progetti Totali: ${state.projects.length}\n` +
        `✅ Progetti Completati: ${completedProjects}\n` +
        `🔄 Progetti Aperti: ${openProjects}\n\n` +
        `📅 Giorni Totali Rimasti: ${totalRemainingDays}`;

    alert(message);
}

// ─── Tabella progetti ─────────────────────────────────────────────────────────

/**
 * Renderizza la tabella dei progetti nel tab "Progetti".
 * Applica filtri e ordinamento dai controlli UI.
 */
export function renderProjects() {
    const tbody = document.querySelector('#projectsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const sortBy           = document.getElementById('projectSortBy')?.value || 'code';
    const hideCompleted    = document.getElementById('hideCompletedProjects')?.checked || false;
    const filterClient     = document.getElementById('projectFilterClient')?.value.toLowerCase() || '';
    const filterCode       = document.getElementById('projectFilterCode')?.value.toLowerCase() || '';
    const filterDescription = document.getElementById('projectFilterDescription')?.value.toLowerCase() || '';

    let filteredProjects = [...state.projects];

    if (hideCompleted) {
        filteredProjects = filteredProjects.filter(p => calculateProjectStats(p).completion < 100);
    }
    if (filterClient) {
        filteredProjects = filteredProjects.filter(p =>
            (p.client || '').toLowerCase().includes(filterClient)
        );
    }
    if (filterCode) {
        filteredProjects = filteredProjects.filter(p =>
            (p.code || '').toLowerCase().includes(filterCode)
        );
    }
    if (filterDescription) {
        filteredProjects = filteredProjects.filter(p =>
            (p.description || '').toLowerCase().includes(filterDescription)
        );
    }

    filteredProjects.sort((a, b) => {
        if (sortBy === 'client') {
            return (a.client || '').localeCompare(b.client || '');
        }
        return (a.code || '').localeCompare(b.code || '');
    });

    // Ritardi da assenze
    const tasksWithDelays = findTasksWithAbsenceDelays();

    // Scala per la barra numero attività rimanenti
    const maxIncompleteTasks = Math.max(
        ...filteredProjects.map(p => {
            return p.tasks
                ? p.tasks.filter(t => t.completion < 100 && t.status !== 'completata' && t.status !== 'annullata').length
                : 0;
        }),
        1
    );

    const OFFER_STATUS_COLORS = {
        'in-preparazione': '#999',
        'inviata':         '#2196F3',
        'accettata':       '#4CAF50',
        'rifiutata':       '#f44336'
    };

    filteredProjects.forEach(project => {
        const stats = calculateProjectStats(project);

        // Indicatore ritardi da assenze
        const projectDelays  = tasksWithDelays.filter(td => td.project.id === project.id);
        const delayIndicator = projectDelays.length > 0
            ? `<span style="color: #ff6b6b; font-weight: bold;" title="${projectDelays.length} attività con ritardi da assenze"> ⚠️ ${projectDelays.length}</span>`
            : '';

        const incompleteTasks    = project.tasks
            ? project.tasks.filter(t => t.completion < 100 && t.status !== 'completata' && t.status !== 'annullata').length
            : 0;
        const incompleteBarWidth = maxIncompleteTasks > 0 ? (incompleteTasks / maxIncompleteTasks) * 100 : 0;

        // Bug aperti / in lavorazione
        const openBugs       = project.issues ? project.issues.filter(i => i.status === 'aperto').length : 0;
        const inProgressBugs = project.issues ? project.issues.filter(i => i.status === 'in-lavorazione').length : 0;
        let bugDisplay = '';
        if (openBugs > 0 && inProgressBugs > 0) {
            bugDisplay = `<span style="color: #d32f2f; font-weight: bold;">${openBugs}</span>/<span style="color: #f57c00; font-weight: bold;">${inProgressBugs}</span>`;
        } else if (openBugs > 0) {
            bugDisplay = `<span style="color: #d32f2f; font-weight: bold;">${openBugs}</span>`;
        } else if (inProgressBugs > 0) {
            bugDisplay = `<span style="color: #f57c00; font-weight: bold;">${inProgressBugs}</span>`;
        } else {
            bugDisplay = '<span style="color: var(--text-tertiary);">-</span>';
        }

        // Offerte per stato
        const totalOffers = project.offers ? project.offers.length : 0;
        let offerDisplay  = '';
        let offerTitle    = 'Offerte';
        if (totalOffers === 0) {
            offerDisplay = '<span style="color: var(--text-tertiary);">-</span>';
        } else {
            const offerStatusOrder = ['in-preparazione', 'inviata', 'accettata', 'rifiutata'];
            const byStatus = offerStatusOrder
                .map(s => ({ s, count: project.offers.filter(o => o.status === s).length }))
                .filter(x => x.count > 0);
            offerTitle   = 'Offerte: ' + byStatus.map(x => `${x.s.replace('-', ' ')}: ${x.count}`).join(', ');
            const partials = byStatus.map(x =>
                `<span style="color:${OFFER_STATUS_COLORS[x.s]};font-weight:bold;">${x.count}</span>`
            ).join(' ');
            offerDisplay = `${totalOffers} (${partials})`;
        }

        // Classe colore barra progresso
        let progressClass = 'low';
        if (stats.completion >= 70)      progressClass = 'high';
        else if (stats.completion >= 40) progressClass = 'medium';

        const tr = document.createElement('tr');
        tr.className    = 'project-item';
        tr.style.cursor = 'pointer';

        tr.innerHTML = `
            <td>${escapeHtml(project.client)}</td>
            <td>${escapeHtml(project.code)}${delayIndicator}</td>
            <td>${escapeHtml(project.description || '')}</td>
            <td>${stats.startDate || '-'}</td>
            <td>${stats.endDate || '-'}</td>
            <td>
                <div style="position: relative; padding: 4px 0;">
                    <span style="position: relative; z-index: 1;">${incompleteTasks}</span>
                    <div style="position: absolute; bottom: 0; left: 0; height: 3px; width: ${incompleteBarWidth}%; background: #2196F3; border-radius: 2px;"></div>
                </div>
            </td>
            <td style="text-align: center; padding: 8px;" title="Bug critici: rosso=aperti, arancione=in lavorazione">${bugDisplay}</td>
            <td style="text-align: center; padding: 2px 4px; white-space: nowrap;" title="${offerTitle}">${offerDisplay}</td>
            <td>
                <div class="project-progress-container">
                    <div class="project-progress-fill ${progressClass}" style="width: ${stats.completion}%"></div>
                    <span class="project-progress-text">${stats.completion}% (${stats.remainingDays}gg)</span>
                </div>
            </td>
            <td class="action-buttons">
                <button onclick="event.stopPropagation(); window.openProjectModal?.(${project.id})" class="secondary">✏️ Modifica</button>
                <button onclick="event.stopPropagation(); window.deleteProject?.(${project.id})" class="delete">🗑️ Elimina</button>
            </td>
        `;

        tr.onclick = function (e) {
            if (!e.target.closest('.action-buttons')) {
                openProjectDetails(project.id);
            }
        };

        tbody.appendChild(tr);
    });

    // Aggiorna anche le select dei progetti
    updateProjectSelects();
}

// ─── Select progetti ──────────────────────────────────────────────────────────

/**
 * Aggiorna tutte le <select> che contengono la lista dei progetti
 * (usata da template, copy-task, ecc.).
 */
export function updateProjectSelects() {
    const select = document.getElementById('projectSelectForTemplate');
    if (select) {
        select.innerHTML = '<option value="">-- Seleziona Progetto --</option>';
        state.projects.forEach(p => {
            const option       = document.createElement('option');
            option.value       = p.id;
            option.textContent = `${p.client} - ${p.code}`;
            select.appendChild(option);
        });
    }
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

/** Svuota il form del modal progetto e resetta lo stato di editing. */
function _clearProjectForm() {
    state.setCurrentProjectId(null);
    const f = (id) => document.getElementById(id);
    if (f('projectClient'))       f('projectClient').value = '';
    if (f('projectCode'))         f('projectCode').value = '';
    if (f('projectDescription'))  f('projectDescription').value = '';
    if (f('projectTemplateSelect')) f('projectTemplateSelect').value = '';
}

// ─── Modal progetto ───────────────────────────────────────────────────────────

/**
 * Apre il modal per creare un nuovo progetto (id = null) o modificarne uno esistente.
 * @param {number|null} id  - id del progetto da modificare, o null per nuovo
 */
export function openProjectModal(id = null) {
    state.setCurrentProjectId(id);
    const modal = document.getElementById('projectModal');
    const title = document.getElementById('projectModalTitle');

    // Popola select template
    const templateSelect = document.getElementById('projectTemplateSelect');
    if (templateSelect) {
        templateSelect.innerHTML = '<option value="">-- Nessun Template --</option>';
        state.templates.forEach(template => {
            const option       = document.createElement('option');
            option.value       = template.id;
            option.textContent = template.name;
            templateSelect.appendChild(option);
        });
    }

    // Popola suggerimenti clienti (da progetti e stabilimenti)
    const clientDatalist = document.getElementById('clientSuggestions');
    if (clientDatalist) {
        clientDatalist.innerHTML = '';
        getAllUniqueClients(state.projects, state.plants).forEach(client => {
            const option   = document.createElement('option');
            option.value   = client;
            clientDatalist.appendChild(option);
        });
    }

    if (id) {
        title.textContent = 'Modifica Progetto';
        const project = state.projects.find(p => p.id === id);
        if (project) {
            document.getElementById('projectClient').value      = project.client;
            document.getElementById('projectCode').value        = project.code;
            document.getElementById('projectDescription').value = project.description || '';
        }
        // Nascondi select template in modalità modifica
        if (templateSelect) templateSelect.parentElement.style.display = 'none';
    } else {
        title.textContent = 'Nuovo Progetto';
        _clearProjectForm();
        // Mostra select template in modalità nuovo
        if (templateSelect) templateSelect.parentElement.style.display = 'block';
    }

    // Inizializza editor markdown per la descrizione
    if (typeof createMarkdownEditor === 'function') {
        createMarkdownEditor('projectDescription', null, false);
    }

    openModal(modal);
}

/** Chiude il modal progetto. */
export function closeProjectModal() {
    closeModal(document.getElementById('projectModal'));
    _clearProjectForm();
}

// ─── CRUD progetto ────────────────────────────────────────────────────────────

/**
 * Legge il form, valida e salva (crea o aggiorna) il progetto in stato e IndexedDB.
 */
export async function saveProject() {
    const client      = document.getElementById('projectClient').value.trim();
    const code        = document.getElementById('projectCode').value.trim();
    const description = document.getElementById('projectDescription').value.trim();
    const templateId  = document.getElementById('projectTemplateSelect')?.value || '';

    if (!client || !code) {
        alert('Cliente e Codice sono obbligatori');
        return;
    }

    const existingProject = state.currentProjectId
        ? state.projects.find(p => p.id === state.currentProjectId)
        : null;

    const project = {
        id:          state.currentProjectId || Date.now(),
        client,
        code,
        description,
        milestones:  existingProject ? existingProject.milestones        : [],
        tasks:       existingProject ? existingProject.tasks             : [],
        taskGroups:  existingProject ? (existingProject.taskGroups || []) : [],
        generalInfo: existingProject ? existingProject.generalInfo       : '',
        updates:     existingProject ? existingProject.updates     : [],
        offers:      existingProject ? existingProject.offers      : [],
        issues:      existingProject ? existingProject.issues      : [],
        meetings:    existingProject ? existingProject.meetings    : []
    };

    if (state.currentProjectId) {
        // Aggiornamento
        const updatedProjects = state.projects.map(p =>
            p.id === state.currentProjectId ? project : p
        );
        state.setProjects(updatedProjects);
    } else {
        // Creazione
        state.setProjects([...state.projects, project]);
    }

    await db.save('projects', project);

    // Applica template se selezionato (solo alla creazione)
    if (!state.currentProjectId && templateId) {
        if (typeof window.applyTemplateToProject === 'function') {
            window.applyTemplateToProject(templateId, project.id, true);
            // applyTemplateToProject gestisce il proprio salvataggio
            calculateHolidays();
            renderHolidays();
            renderProjects();
            closeProjectModal();
            return;
        }
    }

    calculateHolidays();
    renderHolidays();
    renderProjects();
    closeProjectModal();
}

/**
 * Elimina un progetto dopo conferma.
 * @param {number} id  - id del progetto da eliminare
 */
export async function deleteProject(id) {
    if (!confirm('Sei sicuro di voler eliminare questo progetto?')) return;

    state.setProjects(state.projects.filter(p => p.id !== id));
    await db.remove('projects', id);

    renderProjects();
}

// ─── Pannello dettaglio progetto ──────────────────────────────────────────────

/**
 * Apre il pannello dettaglio del progetto con tutte le sue sotto-sezioni.
 * @param {number} id  - id del progetto da visualizzare
 */
export async function openProjectDetails(id) {
    _projectListScrollPosition = window.pageYOffset || document.documentElement.scrollTop;

    // Pulisci selezione attività per analisi
    state.selectedTasksForAnalysis.clear();
    const selBar  = document.getElementById('taskSelectionBar');
    if (selBar)  selBar.style.display = 'none';
    const anPanel = document.getElementById('analyzeResourcesPanel');
    if (anPanel) anPanel.style.display = 'none';

    state.setCurrentProjectId(id);
    const project = state.projects.find(p => p.id === id);
    if (!project) return;

    // Aggiorna header del dettaglio
    const nameEl = document.getElementById('currentProjectName');
    if (nameEl) nameEl.textContent = `${project.client} - ${project.code}`;

    // Mostra pannello dettaglio, nascondi lista
    const detailsEl = document.getElementById('projectDetails');
    if (detailsEl) detailsEl.style.display = 'block';

    const projectsTab = document.getElementById('projects');
    if (projectsTab) {
        const actionBar = projectsTab.querySelector(':scope > .action-bar');
        const h3        = projectsTab.querySelector(':scope > h3');
        const table     = document.getElementById('projectsTable');
        if (actionBar) actionBar.style.display = 'none';
        if (h3)        h3.style.display        = 'none';
        if (table)     table.style.display     = 'none';
    }

    // Renderizza le milestone
    renderMilestones();

    // Propaga i link tra attività prima di renderizzarle
    await applyTaskLinks();

    // Renderizza attività (delegato a tasks.js tramite window)
    if (typeof window.renderTasks === 'function') window.renderTasks();

    // Badge giorni
    renderProjectDaysSummary();

    // Popola select risorse nel modal attività
    updateResourceSelects();

    // Sotto-sezioni del dettaglio
    renderProjectGeneralInfo();
    renderProjectUpdates();
    renderProjectOffers();
    renderProjectIssues();
    renderProjectMeetings();

    // Scorri in cima
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
}

/**
 * Chiude il pannello dettaglio e torna alla lista progetti.
 * @param {boolean} restoreScroll  - se true ripristina la posizione di scroll precedente
 */
export function closeProjectDetails(restoreScroll = false) {
    const detailsEl = document.getElementById('projectDetails');
    if (detailsEl) detailsEl.style.display = 'none';

    const projectsTab = document.getElementById('projects');
    if (projectsTab) {
        const actionBar = projectsTab.querySelector(':scope > .action-bar');
        const h3        = projectsTab.querySelector(':scope > h3');
        const table     = document.getElementById('projectsTable');
        if (actionBar) actionBar.style.display = 'block';
        if (h3)        h3.style.display        = 'block';
        if (table)     table.style.display     = 'table';
    }

    state.setCurrentProjectId(null);
    renderProjects();

    setTimeout(() => {
        window.scrollTo({ top: restoreScroll ? _projectListScrollPosition : 0, behavior: 'instant' });
    }, 0);
}

// ─── Info generali ────────────────────────────────────────────────────────────

/**
 * Popola il campo info generali del progetto e inizializza l'editor markdown.
 */
export function renderProjectGeneralInfo() {
    const project = _currentProject();
    if (!project) return;

    const el = document.getElementById('projectGeneralInfo');
    if (!el) return;

    el.value = project.generalInfo || '';

    if (typeof createMarkdownEditor === 'function') {
        createMarkdownEditor('projectGeneralInfo', 'projectGeneralInfoContainer', false);
    }
}

/**
 * Salva le info generali del progetto corrente.
 */
export async function saveProjectGeneralInfo() {
    const project = _currentProject();
    if (!project) return;

    project.generalInfo = document.getElementById('projectGeneralInfo')?.value || '';
    await db.save('projects', project);
}

// ─── Aggiornamenti ────────────────────────────────────────────────────────────

/**
 * Renderizza la tabella degli aggiornamenti del progetto corrente.
 */
export function renderProjectUpdates() {
    const project = _currentProject();
    if (!project) return;

    // Popola select con tag unici
    const select = document.getElementById('updateSearchTags');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '<option value="">-- Tutto --</option>';
        const allTags = new Set();
        (project.updates || []).forEach(u => (u.tags || []).forEach(t => allTags.add(t)));
        const sortedTags = Array.from(allTags).sort();
        sortedTags.forEach(tag => {
            const option       = document.createElement('option');
            option.value       = tag;
            option.textContent = tag;
            select.appendChild(option);
        });
        if (currentValue && sortedTags.includes(currentValue)) select.value = currentValue;
    }

    const tbody = document.querySelector('#projectUpdatesTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const searchTags = select?.value.toLowerCase().trim() || '';
    let updates      = [...(project.updates || [])];

    if (searchTags) {
        updates = updates.filter(u =>
            (u.tags || []).join(' ').toLowerCase().includes(searchTags)
        );
    }

    // Ordina per data decrescente (più recenti prima)
    updates.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    updates.forEach((update, index) => {
        const row  = tbody.insertRow();
        const date = new Date(update.timestamp);

        row.style.cursor = 'pointer';
        row.onclick = function (e) {
            if (e.target.tagName !== 'BUTTON') viewUpdate(index);
        };

        row.innerHTML = `
            <td>${date.toLocaleString('it-IT')}</td>
            <td>${escapeHtml(update.text)}</td>
            <td>${(update.tags || []).map(tag =>
                `<span style="display: inline-block; background: var(--accent-color); color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin: 2px;">${escapeHtml(tag)}</span>`
            ).join(' ')}</td>
            <td>
                <button onclick="event.stopPropagation(); window.deleteProjectUpdate?.(${index})" title="Elimina" style="padding: 4px 8px; font-size: 12px;">🗑️</button>
            </td>
        `;
    });

    if (updates.length === 0) {
        const row = tbody.insertRow();
        row.innerHTML = '<td colspan="4" style="text-align: center; color: var(--text-tertiary); font-style: italic;">Nessun aggiornamento presente</td>';
    }
}

/**
 * Aggiunge un nuovo aggiornamento al progetto corrente.
 */
export async function addProjectUpdate() {
    const project = _currentProject();
    if (!project) return;

    const text      = document.getElementById('updateText')?.value.trim() || '';
    const tagsInput = document.getElementById('updateTags')?.value.trim() || '';

    if (!text) {
        alert("⚠️ Inserisci una descrizione per l'aggiornamento");
        return;
    }

    const tags = tagsInput
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .map(t => (t.startsWith('#') ? t : '#' + t));

    if (!project.updates) project.updates = [];
    project.updates.push({
        timestamp: new Date().toISOString(),
        text,
        tags
    });

    // Pulisci i campi
    const textEl = document.getElementById('updateText');
    const tagsEl = document.getElementById('updateTags');
    if (textEl) textEl.value = '';
    if (tagsEl) tagsEl.value = '';

    await db.save('projects', project);
    renderProjectUpdates();
}

/**
 * Elimina un aggiornamento dalla lista visualizzata (rispetta filtri e ordinamento).
 * @param {number} index  - indice nella vista ordinata/filtrata
 */
export async function deleteProjectUpdate(index) {
    if (!confirm('Eliminare questo aggiornamento?')) return;

    const project = _currentProject();
    if (!project || !project.updates) return;

    const searchTags = document.getElementById('updateSearchTags')?.value.toLowerCase().trim() || '';
    let updates      = [...project.updates];

    if (searchTags) {
        updates = updates.filter(u =>
            (u.tags || []).join(' ').toLowerCase().includes(searchTags)
        );
    }
    updates.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const updateToDelete  = updates[index];
    const originalIndex   = project.updates.indexOf(updateToDelete);
    if (originalIndex > -1) project.updates.splice(originalIndex, 1);

    await db.save('projects', project);
    renderProjectUpdates();
}

/**
 * Apre il modal di visualizzazione di un aggiornamento (sola lettura).
 * @param {number} index  - indice nella vista ordinata/filtrata
 */
export function viewUpdate(index) {
    const project = _currentProject();
    if (!project || !project.updates) return;

    const searchTags = document.getElementById('updateSearchTags')?.value.toLowerCase().trim() || '';
    let updates      = [...project.updates];

    if (searchTags) {
        updates = updates.filter(u =>
            (u.tags || []).join(' ').toLowerCase().includes(searchTags)
        );
    }
    updates.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const update = updates[index];
    if (!update) return;

    const modal = document.getElementById('updateModal');
    if (!modal) return;
    modal.style.display = 'block';

    const date = new Date(update.timestamp);
    const f = id => document.getElementById(id);
    if (f('updateViewDate'))  f('updateViewDate').value  = date.toLocaleString('it-IT');
    if (f('updateViewText'))  f('updateViewText').value  = update.text;
    if (f('updateViewTags'))  f('updateViewTags').value  = (update.tags || []).join(', ');
}

/** Chiude il modal di visualizzazione aggiornamento. */
export function closeUpdateModal() {
    const modal = document.getElementById('updateModal');
    if (modal) modal.style.display = 'none';
}

// ─── Link tra attività ────────────────────────────────────────────────────────

/**
 * Propaga i link start/end tra le attività del progetto corrente,
 * ricalcolando le date di inizio e fine collegate.
 * Salva in IndexedDB se ci sono stati cambiamenti.
 */
export async function applyTaskLinks() {
    const project = _currentProject();
    if (!project || !project.tasks) return;

    let changed       = false;
    const maxIterations = 10;  // Previene loop infiniti
    let iteration     = 0;

    do {
        changed = false;
        iteration++;

        project.tasks.forEach(task => {
            // Aggiorna data inizio se collegata
            if (task.startLinkedTo) {
                const [linkType, linkedId] = task.startLinkedTo.split(':');
                const offset = task.startOffset || 0;

                if (linkType === 'milestone') {
                    const milestone = project.milestones?.find(m => m.id == linkedId);
                    if (milestone?.date) {
                        const newStartDate = calculateDateWithOffset(
                            milestone.date, offset + 1,
                            task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                        );
                        if (task.startDate !== newStartDate) {
                            task.startDate = newStartDate;
                            task.endDate   = calculateEndDateForTask(
                                task.startDate, task.duration,
                                task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                            );
                            changed = true;
                        }
                    }
                } else if (linkType === 'end') {
                    const linkedTask = project.tasks.find(t => t.id == linkedId);
                    if (linkedTask?.endDate) {
                        const newStartDate = calculateDateWithOffset(
                            linkedTask.endDate, offset + 1,
                            task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                        );
                        if (task.startDate !== newStartDate) {
                            task.startDate = newStartDate;
                            task.endDate   = calculateEndDateForTask(
                                task.startDate, task.duration,
                                task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                            );
                            changed = true;
                        }
                    }
                }
            }

            // Aggiorna data fine se collegata
            if (task.endLinkedTo) {
                const [linkType, linkedId] = task.endLinkedTo.split(':');
                const offset = task.endOffset || 0;

                if (linkType === 'milestone') {
                    const milestone = project.milestones?.find(m => m.id == linkedId);
                    if (milestone?.date) {
                        const newEndDate = calculateDateWithOffset(
                            milestone.date, offset - 1,
                            task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                        );
                        if (task.endDate !== newEndDate) {
                            task.endDate   = newEndDate;
                            task.startDate = calculateStartDateForTask(
                                task.endDate, task.duration,
                                task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                            );
                            changed = true;
                        }
                    }
                } else if (linkType === 'start') {
                    const linkedTask = project.tasks.find(t => t.id == linkedId);
                    if (linkedTask?.startDate) {
                        const newEndDate = calculateDateWithOffset(
                            linkedTask.startDate, offset - 1,
                            task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                        );
                        if (task.endDate !== newEndDate) {
                            task.endDate   = newEndDate;
                            task.startDate = calculateStartDateForTask(
                                task.endDate, task.duration,
                                task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                            );
                            changed = true;
                        }
                    }
                }
            }
        });

    } while (changed && iteration < maxIterations);

    if (iteration > 0) {
        await db.save('projects', project);
        if (typeof window.renderTasks === 'function') window.renderTasks();
        renderGantt();
    }
}

// ─── Date collegate nel modal attività ───────────────────────────────────────

/**
 * Aggiorna i campi data nel modal attività quando cambia un link start/end.
 * Legge i valori dal form del modal task e ricalcola le date.
 */
export function updateLinkedDates() {
    const f = id => document.getElementById(id);
    const startLinkedTo = f('taskStartLinkedTo')?.value || '';
    const endLinkedTo   = f('taskEndLinkedTo')?.value   || '';
    const startOffset   = parseInt(f('taskStartOffset')?.value) || 0;
    const endOffset     = parseInt(f('taskEndOffset')?.value)   || 0;
    const duration      = parseInt(f('taskDuration')?.value)    || 1;
    const startDateField = f('taskStartDate');
    const endDateField   = f('taskEndDate');
    const saturdayWork   = f('taskSaturdayWork')?.checked || false;
    const sundayWork     = f('taskSundayWork')?.checked   || false;
    const holidayWork    = f('taskHolidayWork')?.checked  || false;

    // Risorse assegnate nel form
    const assignedResources = [];
    document.querySelectorAll('.resource-item').forEach(item => {
        const selectEl     = item.querySelector('.task-resource-select');
        const percentageEl = item.querySelector('.task-resource-percentage');
        const resourceId   = selectEl?.value;
        const percentage   = parseInt(percentageEl?.value);
        if (resourceId && percentage >= 0) {
            assignedResources.push({ resourceId, percentage });
        }
    });

    const project = _currentProject();
    if (!project) return;

    if (startLinkedTo) {
        const [type, id] = startLinkedTo.split(':');
        let linkedDate   = null;

        if (type === 'milestone') {
            const milestone = project.milestones?.find(m => m.id == id);
            linkedDate = milestone?.date;
        } else {
            const linkedTask = project.tasks?.find(t => t.id == id);
            linkedDate = type === 'end' ? linkedTask?.endDate : linkedTask?.startDate;
        }

        if (linkedDate) {
            const adjustedOffset  = (type === 'end' || type === 'milestone') ? startOffset + 1 : startOffset;
            const calculatedStart = calculateDateWithOffset(
                linkedDate, adjustedOffset, saturdayWork, sundayWork, holidayWork, assignedResources
            );
            startDateField.value  = calculatedStart;
            endDateField.value    = calculateDateWithOffset(
                calculatedStart, duration - 1, saturdayWork, sundayWork, holidayWork, assignedResources
            );
        }

    } else if (endLinkedTo) {
        const [type, id] = endLinkedTo.split(':');
        let linkedDate   = null;

        if (type === 'milestone') {
            const milestone = project.milestones?.find(m => m.id == id);
            linkedDate = milestone?.date;
        } else {
            const linkedTask = project.tasks?.find(t => t.id == id);
            linkedDate = type === 'end' ? linkedTask?.endDate : linkedTask?.startDate;
        }

        if (linkedDate) {
            const adjustedOffset = (type === 'milestone' || type === 'start') ? endOffset - 1 : endOffset;
            const calculatedEnd  = calculateDateWithOffset(
                linkedDate, adjustedOffset, saturdayWork, sundayWork, holidayWork, assignedResources
            );
            endDateField.value   = calculatedEnd;
            startDateField.value = calculateStartDateForTask(
                calculatedEnd, duration, saturdayWork, sundayWork, holidayWork, assignedResources
            );
        }
    }

    // Mostra avviso assenze (delegato a tasks.js tramite window)
    const startDate = startDateField?.value;
    const endDate   = endDateField?.value;
    if (startDate && endDate && assignedResources.length > 0) {
        if (typeof window.showAbsenceWarning === 'function') {
            window.showAbsenceWarning(startDate, endDate, assignedResources);
        }
    }
}
