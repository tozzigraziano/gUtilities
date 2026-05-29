/**
 * js/modules/tasks.js
 *
 * Gestione Attività (Task): CRUD, scheduling, rendering tabella, collegamenti,
 * email, checklist, analisi risorse.
 *
 * Funzioni esportate:
 *   initTaskModal()               → registra event listener del modal (chiamare da app.js)
 *   openTaskModal(id)             → apre modal crea/modifica attività
 *   closeTaskModal()              → chiude modal attività
 *   saveTask()                    → salva (crea o aggiorna) un'attività
 *   editTask(id)                  → popola form con i dati del task (legacy, ora openTaskModal lo fa)
 *   deleteTask(id)                → elimina un'attività dopo conferma
 *   renderTasks()                 → renderizza tabella attività del progetto corrente
 *   calculateEndDate()            → ricalcola data fine nel modal (da inizio+durata)
 *   calculateStartDate()          → ricalcola data inizio nel modal (da fine+durata)
 *   onCalcMethodChange()          → callback cambio metodo calcolo
 *   addTaskResourceRow()          → aggiunge riga risorsa nel form
 *   removeTaskResourceRow(btn)    → rimuove riga risorsa
 *   toggleTaskResourceRow(row)    → toggle stato riga risorsa (abilitata/disabilitata)
 *   updateLinkedDates()           → aggiorna date collegate nel modal
 *   applyTaskLinks()              → propaga dipendenze start/end in tutto il progetto
 *   showAbsenceWarning(s,e,res)   → mostra banner assenze nel modal
 *   changeTaskStatus(id,status)   → cambia stato attività inline
 *   sendTaskEmail()               → genera email + file .ics per l'attività corrente
 *   clearEmailSentDate()          → rimuove la data di invio email dall'attività
 *   toggleFlexibleDate()          → toggle campo data flessibile nel form
 *   toggleTaskAnalysisSelection(taskId, checked)
 *   updateTaskSelectionBar()
 *   clearTaskAnalysisSelection()
 *   analizzaRisorsePerAttivita()
 *
 * Dipendenze v2:
 *   - ../db.js        → db.save
 *   - ../state.js     → state.projects, state.currentProjectId, state.resources,
 *                        state.plants, state.editingTaskId, state.setEditingTaskId,
 *                        state.suggestedStartDate, state.setSuggestedStartDate,
 *                        state.suggestedResourceId, state.setSuggestedResourceId,
 *                        state.selectedTasksForAnalysis
 *   - ../helpers.js   → openModal, closeModal, formatDateLocal,
 *                        escapeHtml, getLocationBadgeHtml,
 *                        countWorkingDaysBetween, calculateEndDateForTask,
 *                        calculateStartDateForTask, calculateDateWithOffset
 *   - ./holidays.js   → calculateHolidays, renderHolidays
 *   - ./resources.js  → updateResourceSelects
 *   - ./warnings.js   → findTasksWithAbsenceDelays
 *   - ./gantt.js      → renderGantt, saveGanttState, restoreGanttState
 *
 * Pattern anti-circolarità (usare window.*):
 *   - renderBacheca            → window.renderBacheca?.()
 *   - renderTaskReview         → window.renderTaskReview?.()
 *   - renderAnnotations        → window.renderAnnotations?.()
 *   - renderResourceView       → window.renderResourceView?.()
 *   - saveResourceViewState    → window.saveResourceViewState?.()
 *   - restoreResourceViewState → window.restoreResourceViewState?.(state)
 *   - renderProjectDaysSummary → window.renderProjectDaysSummary?.()
 *   - updateTaskSelectionBar   → window.updateTaskSelectionBar?.() (da taskReview)
 *   - togglePlantSelector      → window.togglePlantSelector?.()
 *   - updatePlantSelect        → window.updatePlantSelect?.()
 *   - updatePlantInfoBadge     → window.updatePlantInfoBadge?.()
 *   - createMarkdownEditor     → typeof createMarkdownEditor === 'function' && ...
 *   - loadChecklistItems       → typeof loadChecklistItems === 'function' && ...
 *   - clearChecklistItems      → typeof clearChecklistItems === 'function' && ...
 *   - getChecklistItems        → typeof getChecklistItems === 'function' ? ... : []
 */

import * as db    from '../db.js';
import * as state from '../state.js';
import * as Auth  from './auth.js';
import {
    openModal,
    closeModal,
    formatDateLocal,
    escapeHtml,
    getLocationBadgeHtml,
    countWorkingDaysBetween,
    calculateEndDateForTask,
    calculateStartDateForTask,
    calculateDateWithOffset
} from '../helpers.js';
import { calculateHolidays, renderHolidays } from './holidays.js';
import { updateResourceSelects }             from './resources.js';
import { findTasksWithAbsenceDelays }        from './warnings.js';
import {
    renderGantt,
    saveGanttState,
    restoreGanttState
} from './gantt.js';

// ─── Helpers accesso stato ─────────────────────────────────────────────────────

/** Ritorna il progetto correntemente aperto. */
function _currentProject() {
    return state.projects.find(p => p.id === state.currentProjectId) || null;
}

// ─── Inizializzazione event listener del modal ─────────────────────────────────

/**
 * Registra tutti gli event listener del modal attività.
 * Va chiamata una sola volta all'avvio dell'app (da app.js).
 */
export function initTaskModal() {
    const f = id => document.getElementById(id);

    f('taskStartDate')?.addEventListener('change', () => {
        if (f('calcFromStart')?.checked) calculateEndDate();
    });
    f('taskEndDate')?.addEventListener('change', () => {
        if (f('calcFromEnd')?.checked) calculateStartDate();
    });
    f('taskDuration')?.addEventListener('input', () => {
        onCalcMethodChange();
        updateLinkedDates();
    });
    f('taskSaturdayWork')?.addEventListener('change', onCalcMethodChange);
    f('taskSundayWork')?.addEventListener('change',   onCalcMethodChange);
    f('taskHolidayWork')?.addEventListener('change',  onCalcMethodChange);
    f('calcFromStart')?.addEventListener('change',    onCalcMethodChange);
    f('calcFromEnd')?.addEventListener('change',      onCalcMethodChange);

    // Collegamento data inizio
    f('taskStartLinkedTo')?.addEventListener('change', function() {
        const hasLink        = this.value !== '';
        const startDateField = f('taskStartDate');
        const endDateField   = f('taskEndDate');
        const calcFromStart  = f('calcFromStart');
        const calcFromEnd    = f('calcFromEnd');
        const endLinkedSelect  = f('taskEndLinkedTo');
        const endOffsetField   = f('taskEndOffset');

        if (hasLink) {
            calcFromStart.checked  = true;
            calcFromStart.disabled = true;
            calcFromEnd.disabled   = true;
            startDateField.disabled = true;
            endDateField.disabled   = true;
            endLinkedSelect.disabled = true;
            endOffsetField.disabled  = true;
            endLinkedSelect.value    = '';
            updateLinkedDates();
        } else {
            calcFromStart.disabled  = false;
            calcFromEnd.disabled    = false;
            startDateField.disabled = false;
            endDateField.disabled   = false;
            endLinkedSelect.disabled = false;
            endOffsetField.disabled  = false;
        }
    });

    // Collegamento data fine
    f('taskEndLinkedTo')?.addEventListener('change', function() {
        const hasLink         = this.value !== '';
        const startDateField  = f('taskStartDate');
        const endDateField    = f('taskEndDate');
        const calcFromStart   = f('calcFromStart');
        const calcFromEnd     = f('calcFromEnd');
        const startLinkedSelect = f('taskStartLinkedTo');
        const startOffsetField  = f('taskStartOffset');

        if (hasLink) {
            calcFromEnd.checked     = true;
            calcFromStart.disabled  = true;
            calcFromEnd.disabled    = true;
            startDateField.disabled = true;
            endDateField.disabled   = true;
            startLinkedSelect.disabled = true;
            startOffsetField.disabled  = true;
            startLinkedSelect.value    = '';
            updateLinkedDates();
        } else {
            calcFromStart.disabled  = false;
            calcFromEnd.disabled    = false;
            startDateField.disabled = false;
            endDateField.disabled   = false;
            startLinkedSelect.disabled = false;
            startOffsetField.disabled  = false;
        }
    });

    f('taskStartOffset')?.addEventListener('input', updateLinkedDates);
    f('taskEndOffset')?.addEventListener('input',   updateLinkedDates);

    // Tracking completamento
    function _onCompletionChange() {
        const completion   = parseInt(f('taskCompletion')?.value) || 0;
        const statusField  = f('taskStatus');
        const startedAt    = f('taskStartedAt');
        const completedAt  = f('taskCompletedAt');
        const today        = formatDateLocal(new Date());

        if (completion === 100) {
            statusField.value = 'completata';
            if (!startedAt.value)  startedAt.value  = today;
            if (!completedAt.value) completedAt.value = today;
        } else if (completion > 0) {
            if (!statusField.value) statusField.value = 'in-corso';
            if (!startedAt.value)  startedAt.value  = today;
            completedAt.value = '';
        } else {
            startedAt.value  = '';
            completedAt.value = '';
        }
        updateTrackingDaysDiff();
    }

    const completionEl = f('taskCompletion');
    if (completionEl) {
        completionEl.addEventListener('input',  _onCompletionChange);
        completionEl.addEventListener('change', _onCompletionChange);
    }

    f('taskStartedAt')?.addEventListener('change',   updateTrackingDaysDiff);
    f('taskCompletedAt')?.addEventListener('change',  updateTrackingDaysDiff);
}

// ─── Modal apri / chiudi ───────────────────────────────────────────────────────

/**
 * Apre il modal attività.
 * @param {number|null} id  - ID del task da modificare, null per nuovo task
 */
export function openTaskModal(id = null) {
    const f = i => document.getElementById(i);

    state.setEditingTaskId(id);
    const modal = f('taskModal');
    const title = f('taskModalTitle');

    // Popola dropdown di collegamento
    _updateTaskLinkSelects(id);

    if (id) {
        title.textContent = 'Modifica Attività';
        f('taskDeleteBtn').style.display = '';

        const project = _currentProject();
        if (project) {
            // Banner progetto
            const banner = f('taskProjectBanner');
            f('taskProjectClient').textContent = project.client || '';
            f('taskProjectCode').textContent   = project.code   || '';
            const descWrap = f('taskProjectDescriptionWrap');
            const descEl   = f('taskProjectDescription');
            if (project.description) {
                descEl.textContent     = project.description;
                descWrap.style.display = '';
            } else {
                descWrap.style.display = 'none';
            }
            banner.style.display = 'block';

            const task = project.tasks?.find(t => t.id === id);
            if (task) {
                f('taskName').value       = task.name;
                f('taskStartDate').value  = task.startDate || '';
                f('taskDuration').value   = task.duration;
                f('taskCompletion').value = task.completion;
                f('taskStatus').value     = task.status;
                f('taskNotes').value      = task.notes      || '';
                f('taskAnnotation').value = task.annotation || '';
                f('taskSaturdayWork').checked = task.saturdayWork  || false;
                f('taskSundayWork').checked   = task.sundayWork    || false;
                f('taskHolidayWork').checked  = task.holidayWork   || false;
                f('taskEndDate').value    = task.endDate    || '';
                f('taskFlexibleDate').checked = task.flexibleDate  || false;

                // Location
                if (typeof window.updatePlantSelect === 'function') window.updatePlantSelect();
                f('taskLocationType').value = task.locationType || 'sede';
                if (typeof window.togglePlantSelector === 'function') window.togglePlantSelector();
                if (task.plantId) {
                    f('taskPlantId').value = task.plantId;
                    if (typeof window.updatePlantInfoBadge === 'function') window.updatePlantInfoBadge();
                }

                // Data flessibile: aggiorna stato campi
                if (task.flexibleDate) {
                    toggleFlexibleDate();
                }

                // Collegamenti
                f('taskStartLinkedTo').value = task.startLinkedTo || '';
                f('taskEndLinkedTo').value   = task.endLinkedTo   || '';
                f('taskStartOffset').value   = task.startOffset   || 0;
                f('taskEndOffset').value     = task.endOffset     || 0;

                // Disabilita campi in base ai collegamenti (se non data flessibile)
                if (!task.flexibleDate) {
                    const startDateField    = f('taskStartDate');
                    const endDateField      = f('taskEndDate');
                    const calcFromStart     = f('calcFromStart');
                    const calcFromEnd       = f('calcFromEnd');
                    const startLinkedSelect = f('taskStartLinkedTo');
                    const endLinkedSelect   = f('taskEndLinkedTo');
                    const startOffsetField  = f('taskStartOffset');
                    const endOffsetField    = f('taskEndOffset');

                    if (task.startLinkedTo) {
                        calcFromStart.checked  = true;
                        calcFromStart.disabled = true;
                        calcFromEnd.disabled   = true;
                        startDateField.disabled = true;
                        endDateField.disabled   = true;
                        endLinkedSelect.disabled = true;
                        endOffsetField.disabled  = true;
                    } else if (task.endLinkedTo) {
                        calcFromEnd.checked    = true;
                        calcFromStart.disabled = true;
                        calcFromEnd.disabled   = true;
                        startDateField.disabled = true;
                        endDateField.disabled   = true;
                        startLinkedSelect.disabled = true;
                        startOffsetField.disabled  = true;
                    } else {
                        calcFromStart.disabled  = false;
                        calcFromEnd.disabled    = false;
                        startDateField.disabled = false;
                        endDateField.disabled   = false;
                        startLinkedSelect.disabled = false;
                        endLinkedSelect.disabled   = false;
                        startOffsetField.disabled  = false;
                        endOffsetField.disabled    = false;
                    }
                }

                // Risorse
                const container = f('taskResources');
                container.innerHTML = '';
                if (task.resources && task.resources.length > 0) {
                    task.resources.forEach(res => {
                        addTaskResourceRow();
                        const items  = container.querySelectorAll('.resource-item');
                        const item   = items[items.length - 1];
                        const selEl  = item.querySelector('.task-resource-select');
                        const pctEl  = item.querySelector('.task-resource-percentage');
                        const cmpEl  = item.querySelector('.task-resource-completion');
                        selEl.value  = res.resourceId;
                        pctEl.value  = res.percentage;
                        if (cmpEl) cmpEl.value = res.completion || 0;
                    });
                } else {
                    addTaskResourceRow();
                }

                // Ricalcola date collegate dopo il caricamento risorse
                if (!task.flexibleDate) updateLinkedDates();

                // Avviso assenze
                if (task.startDate && task.endDate && task.resources) {
                    showAbsenceWarning(task.startDate, task.endDate, task.resources);
                }

                // Checklist
                if (task.checklist && task.checklist.length > 0) {
                    if (typeof loadChecklistItems === 'function') loadChecklistItems(task.checklist);
                } else {
                    if (typeof clearChecklistItems === 'function') clearChecklistItems();
                }

                // Tracking
                f('taskStartedAt').value   = task.startedAt   || '';
                f('taskCompletedAt').value = task.completedAt || '';
                updateTrackingDaysDiff();

                // Data creazione
                const createdAtDisplay = f('taskCreatedAtDisplay');
                if (task.createdAt) {
                    const [y, m, d] = task.createdAt.split('-');
                    createdAtDisplay.textContent   = `Creata il: ${d}/${m}/${y}`;
                    createdAtDisplay.style.display = 'block';
                } else {
                    createdAtDisplay.textContent   = '';
                    createdAtDisplay.style.display = 'none';
                }

                // Data invio email
                const emailSentDisplay = f('taskEmailSentDisplay');
                if (task.emailSentAt) {
                    const [y, m, d] = task.emailSentAt.split('-');
                    emailSentDisplay.innerHTML = `Inviata: ${d}/${m}/${y} <span onclick="window.clearEmailSentDate?.()" style="cursor:pointer; margin-left:4px; color:#ff6b6b;" title="Cancella data invio">✕</span>`;
                } else {
                    emailSentDisplay.innerHTML = '';
                }

                // Lavoro notturno
                f('taskNightWork').value = task.nightWork || '';
                // Gruppo
                populateGroupSelect();
                if (f('taskGroupId')) f('taskGroupId').value = task.groupId || '';
            }
        }
    } else {
        title.textContent = 'Nuova Attività';
        f('taskProjectBanner').style.display = 'none';
        f('taskDeleteBtn').style.display = 'none';
        f('taskCreatedAtDisplay').textContent   = '';
        f('taskCreatedAtDisplay').style.display = 'none';
        f('taskEmailSentDisplay').innerHTML = '';
        _clearTaskForm();
        populateGroupSelect();
        if (typeof window.updatePlantSelect === 'function') window.updatePlantSelect();
    }

    updateResourceSelects();

    // Applica restrizioni modalità sola lettura per utente personal
    const _tmUser = Auth.getCurrentUser();
    if (id && _tmUser?.role === 'personal') {
        const _tmProj = _currentProject();
        const _tmTask = _tmProj?.tasks?.find(t => t.id === id);
        if (_tmTask) _applyPersonalTaskRestrictions(_tmTask, _tmUser.resourceId);
    }

    // Editor con tipi risorsa limitati: blocca rimozione/cambio delle risorse non di propria gestione
    if (id && _tmUser?.role === 'editor'
        && Array.isArray(_tmUser.allowedResourceTypes)
        && _tmUser.allowedResourceTypes.length > 0) {
        const _edContainer = f('taskResources');
        _edContainer?.querySelectorAll('.resource-item').forEach(item => {
            const selEl     = item.querySelector('.task-resource-select');
            const removeBtn = item.querySelector('.delete-resource');
            const resourceId = selEl?.value;
            if (!resourceId) return;
            const _edRes = state.resources.find(r => String(r.id) === String(resourceId));
            if (_edRes && !_tmUser.allowedResourceTypes.includes(_edRes.type)) {
                if (removeBtn) { removeBtn.disabled = true; removeBtn.title = 'Risorsa non di tua gestione'; }
                if (selEl)     { selEl.disabled = true; }
            }
        });
    }

    // Editor Markdown note
    const notesTextarea = f('taskNotes');
    if (notesTextarea && typeof createMarkdownEditor === 'function') {
        createMarkdownEditor('taskNotes', null, false);
    }

    openModal(modal);
}

/** Chiude il modal attività e pulisce il form. */
export function closeTaskModal() {
    closeModal(document.getElementById('taskModal'));
    _clearTaskForm();
}

// ─── Form helpers (privati) ────────────────────────────────────────────────────

/** Pulisce e resetta il form del modal attività. */
function _clearTaskForm() {
    const f = i => document.getElementById(i);

    state.setEditingTaskId(null);
    f('taskName').value       = '';
    f('taskStartDate').value  = '';
    f('taskDuration').value   = '1';
    f('taskCompletion').value = '0';
    f('taskStatus').value     = '';
    f('taskNotes').value      = '';
    f('taskAnnotation').value = '';
    f('taskSaturdayWork').checked = false;
    f('taskSundayWork').checked   = false;
    f('taskHolidayWork').checked  = false;
    f('taskEndDate').value    = '';
    f('taskStartLinkedTo').value = '';
    f('taskEndLinkedTo').value   = '';
    f('taskStartOffset').value   = '0';
    f('taskEndOffset').value     = '0';
    f('taskFlexibleDate').checked = false;

    // Location
    f('taskLocationType').value    = 'sede';
    f('taskPlantId').value         = '';
    if (f('taskPlantId'))   f('taskPlantId').style.display   = 'none';
    if (f('taskPlantInfo')) f('taskPlantInfo').style.display = 'none';

    // Nascondi avviso assenze
    const absWarn = f('absenceWarningContainer');
    if (absWarn) absWarn.style.display = 'none';

    // Riabilita tutti i campi
    ['taskStartDate', 'taskEndDate', 'calcFromStart', 'calcFromEnd',
     'taskStartLinkedTo', 'taskEndLinkedTo', 'taskStartOffset', 'taskEndOffset'
    ].forEach(id => { if (f(id)) f(id).disabled = false; });

    // Risorse
    const container = f('taskResources');
    if (container) {
        container.innerHTML = '';
        addTaskResourceRow();
    }
    updateResourceSelects();

    // Checklist
    if (typeof clearChecklistItems === 'function') clearChecklistItems();

    // Tracking
    f('taskStartedAt').value  = '';
    f('taskCompletedAt').value = '';
    if (f('taskDaysDiffDisplay')) f('taskDaysDiffDisplay').innerHTML = '';

    // Campi extra
    f('taskNightWork').value = '';
    if (f('taskGroupId')) f('taskGroupId').value = '';
}

/**
 * Popola i dropdown "Collegato a" (start/end) con le milestones e i task del
 * progetto corrente, escludendo eventualmente il task che si sta modificando.
 * @param {number|null} excludeTaskId
 */
function _updateTaskLinkSelects(excludeTaskId = null) {
    const project = _currentProject();
    if (!project) return;

    const startLinkedSelect = document.getElementById('taskStartLinkedTo');
    const endLinkedSelect   = document.getElementById('taskEndLinkedTo');
    if (!startLinkedSelect || !endLinkedSelect) return;

    // Dropdown inizio: collega alla FINE di un'altra attività o a una milestone
    startLinkedSelect.innerHTML = '<option value="">-- Nessun Collegamento --</option>';

    if (project.milestones) {
        project.milestones.forEach(m => {
            const opt = document.createElement('option');
            opt.value       = `milestone:${m.id}`;
            opt.textContent = `Dopo: 🚩 ${m.name}`;
            startLinkedSelect.appendChild(opt);
        });
    }
    if (project.tasks) {
        project.tasks.forEach(t => {
            if (t.id !== excludeTaskId) {
                const opt = document.createElement('option');
                opt.value       = `end:${t.id}`;
                opt.textContent = `Dopo: ${t.name}`;
                startLinkedSelect.appendChild(opt);
            }
        });
    }

    // Dropdown fine: collega all'INIZIO di un'altra attività o a una milestone
    endLinkedSelect.innerHTML = '<option value="">-- Nessun Collegamento --</option>';

    if (project.milestones) {
        project.milestones.forEach(m => {
            const opt = document.createElement('option');
            opt.value       = `milestone:${m.id}`;
            opt.textContent = `Prima di: 🚩 ${m.name}`;
            endLinkedSelect.appendChild(opt);
        });
    }
    if (project.tasks) {
        project.tasks.forEach(t => {
            if (t.id !== excludeTaskId) {
                const opt = document.createElement('option');
                opt.value       = `start:${t.id}`;
                opt.textContent = `Prima di: ${t.name}`;
                endLinkedSelect.appendChild(opt);
            }
        });
    }
}

// ─── Righe Risorsa nel modal ───────────────────────────────────────────────────

/** Aggiunge una riga risorsa nel form del modal attività. */
export function addTaskResourceRow() {
    const container = document.getElementById('taskResources');

    // Rimuovi eventuale pulsante "+ Aggiungi" già esistente
    const existingAddBtn = container.querySelector('.add-resource-btn');
    if (existingAddBtn) existingAddBtn.remove();

    const newResource = document.createElement('div');
    newResource.className = 'resource-item';

    let options = '<option value="">-- Seleziona Risorsa --</option>';
    state.resources.forEach(r => {
        options += `<option value="${r.id}">${r.firstName} ${r.lastName}</option>`;
    });

    newResource.innerHTML = `
        <button type="button" onclick="window.removeTaskResourceRow?.(this)" class="delete-resource" title="Rimuovi risorsa">🗑️</button>
        <select class="task-resource-select">${options}</select>
        <label>Coinvolgimento:</label>
        <input type="number" class="task-resource-percentage" min="0" max="100" step="25" value="100" placeholder="%">
        <span>%</span>
        <label style="margin-left: 10px;">Completamento:</label>
        <input type="number" class="task-resource-completion" min="0" max="100" step="10" value="0" placeholder="%">
        <span>%</span>
    `;
    container.appendChild(newResource);

    // Pulsante aggiunta
    const addBtn = document.createElement('button');
    addBtn.type      = 'button';
    addBtn.className = 'add-resource-btn';
    addBtn.textContent = '+ Aggiungi Risorsa';
    addBtn.onclick   = addTaskResourceRow;
    container.appendChild(addBtn);

    // Listener cambio risorsa
    const select = newResource.querySelector('.task-resource-select');
    select.addEventListener('change', () => {
        onCalcMethodChange();
        const startDate = document.getElementById('taskStartDate')?.value;
        const endDate   = document.getElementById('taskEndDate')?.value;
        if (startDate && endDate) {
            const taskResources = _collectFormResources();
            showAbsenceWarning(startDate, endDate, taskResources);
        }
    });
}

/**
 * Rimuove la riga risorsa corrispondente al pulsante premuto.
 * @param {HTMLElement} button - il pulsante di rimozione
 */
export function removeTaskResourceRow(button) {
    const container = document.getElementById('taskResources');
    button.parentElement.remove();

    const remaining = container.querySelectorAll('.resource-item');
    if (remaining.length === 0) addTaskResourceRow();

    onCalcMethodChange();
}

/**
 * Toggle stato di una riga risorsa (abilitata/disabilitata visivamente).
 * Utile per marcare temporaneamente una risorsa come non attiva senza eliminarla.
 * @param {HTMLElement} row - il div .resource-item
 */
export function toggleTaskResourceRow(row) {
    if (!row) return;
    const isDisabled = row.classList.toggle('resource-row-disabled');
    const select = row.querySelector('.task-resource-select');
    const inputs = row.querySelectorAll('input');
    if (select) select.disabled = isDisabled;
    inputs.forEach(inp => { inp.disabled = isDisabled; });
    onCalcMethodChange();
}

// ─── Raccolta risorse dal form ─────────────────────────────────────────────────

/** Legge le righe risorse nel form e ritorna un array {resourceId, percentage}. */
function _collectFormResources() {
    const taskResources = [];
    document.querySelectorAll('.resource-item').forEach(item => {
        const selEl  = item.querySelector('.task-resource-select');
        const pctEl  = item.querySelector('.task-resource-percentage');
        const resourceId = selEl?.value;
        const percentage = parseInt(pctEl?.value);
        if (resourceId && percentage >= 0) {
            taskResources.push({ resourceId, percentage });
        }
    });
    return taskResources;
}

// ─── Calcolo date nel modal ────────────────────────────────────────────────────

/** Ricalcola data fine da data inizio + durata + risorse. */
export function calculateEndDate() {
    const f = i => document.getElementById(i);
    const startDate    = f('taskStartDate')?.value;
    const duration     = parseInt(f('taskDuration')?.value);
    const saturdayWork = f('taskSaturdayWork')?.checked || false;
    const sundayWork   = f('taskSundayWork')?.checked   || false;
    const holidayWork  = f('taskHolidayWork')?.checked  || false;

    if (!startDate || !duration) {
        if (f('taskEndDate')) f('taskEndDate').value = '';
        return;
    }

    const taskResources = _collectFormResources();
    const endDate = calculateEndDateForTask(startDate, duration, saturdayWork, sundayWork, holidayWork, taskResources);
    f('taskEndDate').value = endDate;
    showAbsenceWarning(startDate, endDate, taskResources);
}

/** Ricalcola data inizio da data fine + durata + risorse (a ritroso). */
export function calculateStartDate() {
    const f = i => document.getElementById(i);
    const endDate      = f('taskEndDate')?.value;
    const duration     = parseInt(f('taskDuration')?.value);
    const saturdayWork = f('taskSaturdayWork')?.checked || false;
    const sundayWork   = f('taskSundayWork')?.checked   || false;
    const holidayWork  = f('taskHolidayWork')?.checked  || false;

    if (!endDate || !duration) {
        if (f('taskStartDate')) f('taskStartDate').value = '';
        return;
    }

    const taskResources = _collectFormResources();
    const startDate = calculateStartDateForTask(endDate, duration, saturdayWork, sundayWork, holidayWork, taskResources);
    f('taskStartDate').value = startDate;
    showAbsenceWarning(startDate, endDate, taskResources);
}

/** Callback cambio metodo calcolo (da inizio o da fine). */
export function onCalcMethodChange() {
    const method = document.querySelector('input[name="calcMethod"]:checked')?.value;
    if (method === 'start') {
        calculateEndDate();
    } else {
        calculateStartDate();
    }
}

// ─── Tracking giorni ──────────────────────────────────────────────────────────

/** Calcola e mostra la differenza tra giorni previsti ed effettivi. */
export function updateTrackingDaysDiff() {
    const f = i => document.getElementById(i);
    const startedAt   = f('taskStartedAt')?.value;
    const completedAt = f('taskCompletedAt')?.value;
    const duration    = parseInt(f('taskDuration')?.value) || 0;
    const saturdayWork = f('taskSaturdayWork')?.checked || false;
    const sundayWork   = f('taskSundayWork')?.checked   || false;
    const holidayWork  = f('taskHolidayWork')?.checked  || false;
    const daysDiffDisplay = f('taskDaysDiffDisplay');

    const modalResources = [];
    document.querySelectorAll('.resource-item').forEach(item => {
        const sel = item.querySelector('.task-resource-select');
        if (sel && sel.value) modalResources.push({ resourceId: sel.value });
    });

    if (startedAt && completedAt && duration) {
        const actualDays  = countWorkingDaysBetween(startedAt, completedAt, saturdayWork, sundayWork, holidayWork, modalResources);
        const plannedDays = duration;
        const diff        = actualDays - plannedDays;
        let diffColor = '#4CAF50', diffIcon = '✅', diffLabel = 'in anticipo';
        if (diff > 0) {
            diffColor = '#f44336'; diffIcon = '⚠️'; diffLabel = 'in ritardo';
        } else if (diff === 0) {
            diffLabel = 'nei tempi';
        }
        if (daysDiffDisplay) {
            daysDiffDisplay.innerHTML =
                `${diffIcon} <span style="color: ${diffColor}; font-weight: bold;">${Math.abs(diff)}gg ${diff === 0 ? 'nei tempi' : diffLabel}</span>` +
                ` <span style="color: var(--text-tertiary);">(previsti: ${plannedDays}gg, effettivi: ${actualDays}gg)</span>`;
        }
    } else {
        if (daysDiffDisplay) daysDiffDisplay.innerHTML = '';
    }
}

// ─── Date collegate nel modal ──────────────────────────────────────────────────

/**
 * Aggiorna i campi data nel modal quando cambia un collegamento start/end
 * o quando cambia l'offset.
 */
export function updateLinkedDates() {
    const f = i => document.getElementById(i);
    const startLinkedTo  = f('taskStartLinkedTo')?.value || '';
    const endLinkedTo    = f('taskEndLinkedTo')?.value   || '';
    const startOffset    = parseInt(f('taskStartOffset')?.value) || 0;
    const endOffset      = parseInt(f('taskEndOffset')?.value)   || 0;
    const duration       = parseInt(f('taskDuration')?.value)    || 1;
    const startDateField = f('taskStartDate');
    const endDateField   = f('taskEndDate');
    const saturdayWork   = f('taskSaturdayWork')?.checked || false;
    const sundayWork     = f('taskSundayWork')?.checked   || false;
    const holidayWork    = f('taskHolidayWork')?.checked  || false;

    const assignedResources = _collectFormResources();
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
            const calculatedStart = calculateDateWithOffset(linkedDate, adjustedOffset, saturdayWork, sundayWork, holidayWork, assignedResources);
            startDateField.value  = calculatedStart;
            endDateField.value    = calculateDateWithOffset(calculatedStart, duration - 1, saturdayWork, sundayWork, holidayWork, assignedResources);
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
            const calculatedEnd  = calculateDateWithOffset(linkedDate, adjustedOffset, saturdayWork, sundayWork, holidayWork, assignedResources);
            endDateField.value   = calculatedEnd;
            startDateField.value = calculateStartDateForTask(calculatedEnd, duration, saturdayWork, sundayWork, holidayWork, assignedResources);
        }
    }

    const startDate = startDateField?.value;
    const endDate   = endDateField?.value;
    if (startDate && endDate && assignedResources.length > 0) {
        showAbsenceWarning(startDate, endDate, assignedResources);
    }
}

// ─── Data flessibile ──────────────────────────────────────────────────────────

/**
 * Toggle del campo "data flessibile" nel modal.
 * Abilita/disabilita campi data e calcola date suggerite quando si disattiva.
 */
export function toggleFlexibleDate() {
    const f = i => document.getElementById(i);
    const flexibleDate      = f('taskFlexibleDate')?.checked || false;
    const startDateField    = f('taskStartDate');
    const endDateField      = f('taskEndDate');
    const calcFromStart     = f('calcFromStart');
    const calcFromEnd       = f('calcFromEnd');
    const startLinkedSelect = f('taskStartLinkedTo');
    const endLinkedSelect   = f('taskEndLinkedTo');
    const startOffsetField  = f('taskStartOffset');
    const endOffsetField    = f('taskEndOffset');

    if (flexibleDate) {
        // Data flessibile attiva: disabilita e svuota i campi data/collegamento
        startDateField.disabled = true;
        endDateField.disabled   = true;
        calcFromStart.disabled  = true;
        calcFromEnd.disabled    = true;
        startLinkedSelect.disabled = true;
        endLinkedSelect.disabled   = true;
        startOffsetField.disabled  = true;
        endOffsetField.disabled    = true;

        startDateField.value    = '';
        endDateField.value      = '';
        startLinkedSelect.value = '';
        endLinkedSelect.value   = '';
        startOffsetField.value  = '0';
        endOffsetField.value    = '0';
    } else {
        // Data flessibile disattivata: riabilita e calcola date
        startDateField.disabled = false;
        endDateField.disabled   = false;
        calcFromStart.disabled  = false;
        calcFromEnd.disabled    = false;
        startLinkedSelect.disabled = false;
        endLinkedSelect.disabled   = false;
        startOffsetField.disabled  = false;
        endOffsetField.disabled    = false;

        const suggestedStart = state.suggestedStartDate ? new Date(state.suggestedStartDate) : new Date();
        const duration       = parseInt(f('taskDuration')?.value) || 1;
        const saturdayWork   = f('taskSaturdayWork')?.checked || false;
        const sundayWork     = f('taskSundayWork')?.checked   || false;
        const holidayWork    = f('taskHolidayWork')?.checked  || false;

        const startDateStr = formatDateLocal(suggestedStart);
        startDateField.value = startDateStr;
        endDateField.value   = calculateEndDateForTask(startDateStr, duration, saturdayWork, sundayWork, holidayWork, []);

        // Assegna risorsa suggerita (da click su attività non assegnata in Vista Risorse)
        if (state.suggestedResourceId) {
            const container = f('taskResources');
            const existingItems = container.querySelectorAll('.resource-item');
            let alreadyAssigned = false;

            existingItems.forEach(item => {
                const sel = item.querySelector('.task-resource-select');
                if (sel && sel.value == state.suggestedResourceId) alreadyAssigned = true;
            });

            if (!alreadyAssigned) {
                if (existingItems.length === 1) {
                    const firstItem = existingItems[0];
                    const sel = firstItem.querySelector('.task-resource-select');
                    const pct = firstItem.querySelector('.task-resource-percentage');
                    if (!sel.value) {
                        sel.value = state.suggestedResourceId;
                        pct.value = 100;
                    } else {
                        _appendSuggestedResource(container);
                    }
                } else {
                    _appendSuggestedResource(container);
                }
            }
        }

        // Reset variabili suggerite
        state.setSuggestedStartDate(null);
        state.setSuggestedResourceId(null);
    }
}

/** Aggiunge una riga con la risorsa suggerita alla fine del container. */
function _appendSuggestedResource(container) {
    addTaskResourceRow();
    const items = container.querySelectorAll('.resource-item');
    const item  = items[items.length - 1];
    const sel   = item.querySelector('.task-resource-select');
    const pct   = item.querySelector('.task-resource-percentage');
    if (sel) sel.value = state.suggestedResourceId;
    if (pct) pct.value = 100;
}

// ─── Restrizioni ruolo personal nel modal attività ──────────────────────────

/**
 * Per utenti 'personal': disabilita tutti i campi di schedulazione, lascia
 * modificabili solo stato, completamento risorsa propria, e (condizionalmente)
 * il completamento generale.
 */
function _applyPersonalTaskRestrictions(task, userResourceId) {
    const f = id => document.getElementById(id);

    // Verifica se l'utente è assegnato a questa attività
    const userInTask = (task.resources || []).some(r => r.resourceId == userResourceId);

    // Campi di sola lettura (scheduling & metadati)
    const readOnlyIds = [
        'taskName', 'taskAnnotation', 'taskStartDate', 'taskEndDate',
        'taskDuration', 'taskFlexibleDate', 'taskSaturdayWork', 'taskSundayWork',
        'taskHolidayWork', 'taskNightWork', 'taskLocationType', 'taskPlantId',
        'taskStartLinkedTo', 'taskEndLinkedTo', 'taskStartOffset', 'taskEndOffset',
        'taskNotes', 'taskGroupId', 'taskStartedAt', 'taskCompletedAt',
        'calcFromStart', 'calcFromEnd'
    ];
    readOnlyIds.forEach(id => { const el = f(id); if (el) el.disabled = true; });

    const completionEl = f('taskCompletion');
    const statusEl     = f('taskStatus');

    if (!userInTask) {
        // Utente non assegnato: sola lettura completa (anche stato e completamento)
        if (completionEl) completionEl.disabled = true;
        if (statusEl)     statusEl.disabled     = true;
        // Nasconde anche il pulsante Salva
        const saveBtn = document.querySelector('#taskModal .modal-footer button[onclick*="saveTask"]');
        if (saveBtn) saveBtn.style.display = 'none';
    } else {
        // taskCompletion: abilitato solo se la risorsa è l'unica o le altre sono al 100%
        const otherResources = (task.resources || []).filter(r => r.resourceId != userResourceId);
        const othersAllAt100 = otherResources.every(r => (r.completion || 0) >= 100);
        if (completionEl) completionEl.disabled = !(otherResources.length === 0 || othersAllAt100);
    }

    // Nasconde pulsanti non consentiti
    const deleteBtn = f('taskDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = 'none';
    const emailBtn = document.querySelector('#taskModal .modal-footer button[onclick*="sendTaskEmail"]');
    if (emailBtn) emailBtn.style.display = 'none';
    const emailSentSpan = f('taskEmailSentDisplay');
    if (emailSentSpan) emailSentSpan.style.display = 'none';

    // Nasconde il pulsante "+ Aggiungi Elemento" checklist
    const addChecklistBtn = document.querySelector('#taskChecklistContainer + button');
    if (addChecklistBtn) addChecklistBtn.style.display = 'none';

    // Righe risorse: disabilita tutto tranne il completamento della propria risorsa
    document.querySelectorAll('#taskResources .resource-item').forEach(item => {
        const selEl  = item.querySelector('.task-resource-select');
        const pctEl  = item.querySelector('.task-resource-percentage');
        const cmpEl  = item.querySelector('.task-resource-completion');
        const delBtn = item.querySelector('.delete-resource');
        const isOwn  = userInTask && selEl?.value == userResourceId;
        if (selEl)  selEl.disabled  = true;
        if (pctEl)  pctEl.disabled  = true;
        if (delBtn) delBtn.style.display = 'none';
        if (cmpEl)  cmpEl.disabled  = !isOwn;
    });
    // Nasconde il pulsante "+ Aggiungi Risorsa"
    const addResBtn = document.querySelector('#taskResources .add-resource-btn');
    if (addResBtn) addResBtn.style.display = 'none';

    // Banner informativo
    const banner = f('taskProjectBanner');
    if (banner) {
        const notice = document.createElement('div');
        notice.style.cssText = 'margin-top:8px;padding:6px 10px;background:var(--warning-bg,#fff3e0);border-left:3px solid var(--warning-color,#f57c00);font-size:12px;border-radius:3px;color:var(--text-primary)';
        notice.textContent   = userInTask
            ? '⚠️ Modalità sola lettura: puoi modificare solo il tuo completamento e lo stato dell\'attività.'
            : '⚠️ Sola lettura: non sei assegnato a questa attività.';
        banner.appendChild(notice);
    }
}

// ─── CRUD Task ────────────────────────────────────────────────────────────────

/**
 * Legge il form, valida e salva (crea o aggiorna) il task nel progetto corrente.
 */
export async function saveTask() {
    const f = i => document.getElementById(i);

    const name         = f('taskName')?.value.trim();
    let   startDate    = f('taskStartDate')?.value;
    const duration     = parseInt(f('taskDuration')?.value);
    const completion   = parseInt(f('taskCompletion')?.value);
    let   status       = f('taskStatus')?.value;
    const notes        = f('taskNotes')?.value.trim();
    const annotation   = f('taskAnnotation')?.value.trim();
    const saturdayWork = f('taskSaturdayWork')?.checked || false;
    const sundayWork   = f('taskSundayWork')?.checked   || false;
    const holidayWork  = f('taskHolidayWork')?.checked  || false;
    let   endDate      = f('taskEndDate')?.value;
    const startLinkedTo = f('taskStartLinkedTo')?.value;
    const endLinkedTo   = f('taskEndLinkedTo')?.value;
    const startOffset   = parseInt(f('taskStartOffset')?.value) || 0;
    const endOffset     = parseInt(f('taskEndOffset')?.value)   || 0;
    let   flexibleDate  = f('taskFlexibleDate')?.checked || false;
    const locationType  = f('taskLocationType')?.value || 'sede';
    const plantId       = locationType === 'cliente' ? (f('taskPlantId')?.value || null) : null;

    // Se completamento > 0 con data flessibile, rimuovi la flessibilità
    if (completion > 0 && flexibleDate) {
        flexibleDate = false;
        const today = new Date();
        startDate   = formatDateLocal(today);
        endDate     = calculateEndDateForTask(startDate, duration, saturdayWork, sundayWork, holidayWork, []);
    }

    // Stato automatico in base al completamento
    if (completion === 100) {
        status = 'completata';
    } else if (completion > 0 && !status) {
        status = 'in-corso';
    }

    if (!name || !duration) {
        alert('Nome e Durata sono obbligatori');
        return;
    }

    // Risorse
    const assignedResources = [];
    document.querySelectorAll('.resource-item').forEach(item => {
        const selEl  = item.querySelector('.task-resource-select');
        const pctEl  = item.querySelector('.task-resource-percentage');
        const cmpEl  = item.querySelector('.task-resource-completion');
        const resourceId  = selEl?.value;
        const percentage  = parseInt(pctEl?.value) || 0;
        const resCompletion = parseInt(cmpEl?.value) || 0;
        if (!isNaN(percentage) && percentage >= 0) {
            assignedResources.push({ resourceId: resourceId || null, percentage, completion: resCompletion });
        }
    });

    // Checklist
    const checklistItems = typeof getChecklistItems === 'function' ? getChecklistItems() : [];

    const project = _currentProject();
    if (!project) return;
    if (!project.tasks) project.tasks = [];

    // Tracking
    const startedAt   = f('taskStartedAt')?.value   || null;
    const completedAt = f('taskCompletedAt')?.value || null;
    const nightWork   = f('taskNightWork')?.value.trim() || null;
    const groupId     = f('taskGroupId')?.value || null;

    // Preserva createdAt e emailSentAt
    let createdAt  = null;
    let emailSentAt = null;
    if (state.editingTaskId) {
        const existing = project.tasks.find(t => t.id === state.editingTaskId);
        if (existing) {
            createdAt   = existing.createdAt   || null;
            emailSentAt = existing.emailSentAt || null;
        }
    } else {
        createdAt = formatDateLocal(new Date());
    }

    const task = {
        id:            state.editingTaskId || Date.now(),
        name,
        startDate,
        duration,
        completion,
        status,
        saturdayWork,
        sundayWork,
        holidayWork,
        endDate,
        startLinkedTo,
        endLinkedTo,
        startOffset,
        endOffset,
        notes,
        annotation,
        resources:     assignedResources,
        flexibleDate:  flexibleDate || false,
        checklist:     checklistItems,
        locationType:  locationType || 'sede',
        plantId:       plantId ? Number(plantId) : null,
        startedAt,
        completedAt,
        createdAt,
        emailSentAt,
        nightWork,
        groupId: groupId || null
    };

    if (state.editingTaskId) {
        const idx = project.tasks.findIndex(t => t.id === state.editingTaskId);
        project.tasks[idx] = task;
    } else {
        project.tasks.push(task);
    }

    // Rimuovi collegamenti da altri task se questo è completato al 100%
    if (completion === 100) {
        project.tasks.forEach(otherTask => {
            if (otherTask.id === task.id) return;
            if (otherTask.startLinkedTo) {
                const [, linkedId] = otherTask.startLinkedTo.split(':');
                if (parseInt(linkedId) === task.id) {
                    otherTask.startLinkedTo = '';
                    otherTask.startOffset   = 0;
                }
            }
            if (otherTask.endLinkedTo) {
                const [, linkedId] = otherTask.endLinkedTo.split(':');
                if (parseInt(linkedId) === task.id) {
                    otherTask.endLinkedTo = '';
                    otherTask.endOffset   = 0;
                }
            }
        });
    }

    await db.save('projects', project);
    calculateHolidays();
    renderHolidays();
    renderTasks();

    // Gantt: salva e ripristina stato scroll/zoom
    const ganttState = saveGanttState();
    renderGantt();
    restoreGanttState(ganttState);

    // Vista Risorse: aggiorna solo se visibile
    const resourceViewTab = document.getElementById('resourceView');
    if (resourceViewTab?.classList.contains('active')) {
        const rvState = typeof window.saveResourceViewState === 'function'
            ? window.saveResourceViewState()
            : null;
        if (typeof window.renderResourceView === 'function') window.renderResourceView();
        if (rvState && typeof window.restoreResourceViewState === 'function') {
            window.restoreResourceViewState(rvState);
        }
    }

    // Bacheca: aggiorna se visibile
    if (document.getElementById('bacheca')?.classList.contains('active')) {
        if (typeof window.renderBacheca === 'function') window.renderBacheca();
    }

    // Revisione Attività: aggiorna se visibile preservando scroll
    if (document.getElementById('taskReview')?.classList.contains('active')) {
        const scrollPos = window.pageYOffset || document.documentElement.scrollTop;
        if (typeof window.renderTaskReview === 'function') window.renderTaskReview();
        window.scrollTo(0, scrollPos);
    }

    // Annotazioni: aggiorna se visibile preservando scroll
    if (document.getElementById('annotations')?.classList.contains('active')) {
        const scrollPos = window.pageYOffset || document.documentElement.scrollTop;
        if (typeof window.renderAnnotations === 'function') window.renderAnnotations();
        window.scrollTo(0, scrollPos);
    }

    closeTaskModal();
    await applyTaskLinks();
}

/**
 * Popola il form con i dati di un task esistente (senza aprire il modal).
 * Nella v2 questa funzione è sostanzialmente inclusa in openTaskModal,
 * ma viene mantenuta per compatibilità con codice che la chiama direttamente.
 * @param {number} id - ID del task da modificare
 */
export function editTask(id) {
    const project = _currentProject();
    if (!project) return;
    const task = project.tasks?.find(t => t.id === id);
    if (!task) return;
    openTaskModal(id);
}

/**
 * Elimina un task dopo conferma utente.
 * @param {number} id - ID del task da eliminare
 */
export async function deleteTask(id) {
    const project = _currentProject();
    if (!project) return;
    const task = project.tasks?.find(t => t.id === id);

    // Restrizioni editor con tipi risorsa limitati
    const _dtUser = Auth.getCurrentUser();
    if (task && _dtUser?.role === 'editor'
        && Array.isArray(_dtUser.allowedResourceTypes)
        && _dtUser.allowedResourceTypes.length > 0) {

        // Blocca se l'attività ha risorse di tipi non gestiti da questo editor
        const hasUnmanaged = (task.resources || []).some(tr => {
            const res = state.resources.find(r => String(r.id) === String(tr.resourceId));
            return res && !_dtUser.allowedResourceTypes.includes(res.type);
        });
        if (hasUnmanaged) {
            alert('Non puoi eliminare questa attività perché contiene risorse non di tua gestione.');
            return;
        }

        // Blocca se altre attività dipendono da questa
        const dependents = (project.tasks || []).filter(t => t.id !== id && (
            t.startLinkedTo === `end:${id}` || t.startLinkedTo === `start:${id}` ||
            t.endLinkedTo   === `end:${id}` || t.endLinkedTo   === `start:${id}`
        ));
        if (dependents.length > 0) {
            const names = dependents.map(t => `"${t.name}"`).join(', ');
            alert(`Non puoi eliminare questa attività perché le seguenti attività dipendono da essa: ${names}.\nRimuovi prima le dipendenze.`);
            return;
        }
    }

    if (!confirm('Sei sicuro di voler eliminare questa attività?')) return;

    project.tasks = project.tasks.filter(t => t.id !== id);
    await db.save('projects', project);

    renderTasks();
    renderGantt();

    if (document.getElementById('bacheca')?.classList.contains('active')) {
        if (typeof window.renderBacheca === 'function') window.renderBacheca();
    }
}

/**
 * Elimina il task attualmente aperto nel modal (chiude prima il modal).
 */
export async function deleteTaskFromModal() {
    if (!state.editingTaskId) return;
    const taskId = state.editingTaskId;
    closeTaskModal();
    await deleteTask(taskId);
}

/**
 * Cambia lo stato di un task direttamente dalla tabella (select inline).
 * @param {number} taskId   - ID del task
 * @param {string} newStatus - Nuovo valore stato
 */
export async function changeTaskStatus(taskId, newStatus) {
    const project = _currentProject();
    if (!project) return;
    const task = project.tasks?.find(t => t.id === taskId);
    if (!task) return;

    task.status = newStatus || undefined;
    if (newStatus === 'completata') task.completion = 100;

    await db.save('projects', project);
    renderTasks();
    renderGantt();

    if (document.getElementById('bacheca')?.classList.contains('active')) {
        if (typeof window.renderBacheca === 'function') window.renderBacheca();
    }
}

// ─── Propagazione link tra task ───────────────────────────────────────────────

/**
 * Propaga i collegamenti start/end tra le attività del progetto corrente.
 * Itera fino a convergenza (max 10 passaggi per prevenire loop infiniti).
 */
export async function applyTaskLinks() {
    const project = _currentProject();
    if (!project || !project.tasks) return;

    let changed       = false;
    const maxIter     = 10;
    let iteration     = 0;

    do {
        changed = false;
        iteration++;

        project.tasks.forEach(task => {
            // Collegamento data inizio
            if (task.startLinkedTo) {
                const [linkType, linkedId] = task.startLinkedTo.split(':');
                const offset = task.startOffset || 0;

                if (linkType === 'milestone') {
                    const milestone = project.milestones?.find(m => m.id == linkedId);
                    if (milestone?.date) {
                        const newStart = calculateDateWithOffset(
                            milestone.date, offset + 1,
                            task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                        );
                        if (task.startDate !== newStart) {
                            task.startDate = newStart;
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
                        const newStart = calculateDateWithOffset(
                            linkedTask.endDate, offset + 1,
                            task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                        );
                        if (task.startDate !== newStart) {
                            task.startDate = newStart;
                            task.endDate   = calculateEndDateForTask(
                                task.startDate, task.duration,
                                task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                            );
                            changed = true;
                        }
                    }
                }
            }

            // Collegamento data fine
            if (task.endLinkedTo) {
                const [linkType, linkedId] = task.endLinkedTo.split(':');
                const offset = task.endOffset || 0;

                if (linkType === 'milestone') {
                    const milestone = project.milestones?.find(m => m.id == linkedId);
                    if (milestone?.date) {
                        const newEnd = calculateDateWithOffset(
                            milestone.date, offset - 1,
                            task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                        );
                        if (task.endDate !== newEnd) {
                            task.endDate   = newEnd;
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
                        const newEnd = calculateDateWithOffset(
                            linkedTask.startDate, offset - 1,
                            task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
                        );
                        if (task.endDate !== newEnd) {
                            task.endDate   = newEnd;
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

    } while (changed && iteration < maxIter);

    if (iteration > 0) {
        await db.save('projects', project);
        renderTasks();
        renderGantt();
    }
}

// ─── Rendering tabella attività ────────────────────────────────────────────────

/**
 * Renderizza la tabella delle attività del progetto corrente.
 * Ordina per data di inizio. Evidenzia attività in ritardo, completate, ecc.
 */
export function renderTasks() {
    const project = _currentProject();
    if (!project) return;

    const tbody = document.querySelector('#tasksTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!project.tasks) project.tasks = [];

    const tasksWithDelays = findTasksWithAbsenceDelays();
    const projectDelays   = tasksWithDelays.filter(td => td.project.id === project.id);

    const sortedTasks = [...project.tasks].sort((a, b) => {
        if (!a.startDate && !b.startDate) return 0;
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return a.startDate.localeCompare(b.startDate);
    });

    const today = formatDateLocal(new Date());

    const statusOptions = [
        { value: '',          label: '-'          },
        { value: 'da-avviare', label: 'Da Avviare' },
        { value: 'in-corso',  label: 'In Corso'   },
        { value: 'in-ritardo', label: 'In Ritardo' },
        { value: 'pausa',     label: 'In Pausa'   },
        { value: 'completata', label: 'Completata' },
        { value: 'annullata', label: 'Annullata'  }
    ];

    // ─── Raggruppamento per gruppi ────────────────────────────────────────────
    const taskGroups = project.taskGroups || [];
    let tasksToRender;
    if (taskGroups.length === 0) {
        tasksToRender = [{ group: null, tasks: sortedTasks }];
    } else {
        const tasksByGroup = new Map();
        tasksByGroup.set(null, []);
        taskGroups.forEach(g => tasksByGroup.set(g.id, []));
        sortedTasks.forEach(task => {
            const gid = task.groupId && tasksByGroup.has(task.groupId) ? task.groupId : null;
            tasksByGroup.get(gid).push(task);
        });
        tasksToRender = [];
        const ungrouped = tasksByGroup.get(null);
        if (ungrouped.length > 0) tasksToRender.push({ group: null, tasks: ungrouped });
        [...taskGroups].sort((a, b) => (a.order || 0) - (b.order || 0))
            .forEach(g => tasksToRender.push({ group: g, tasks: tasksByGroup.get(g.id) || [] }));
    }

    tasksToRender.forEach(({ group, tasks: sectionTasks }) => {
        // Intestazione gruppo
        if (group) {
            const headerTr = document.createElement('tr');
            headerTr.className = 'task-group-header';
            headerTr.setAttribute('data-group-id', group.id);
            headerTr.innerHTML = `<td colspan="11" style="background:${group.color}22; border-left:4px solid ${group.color}; padding:6px 12px;">
                <span class="task-group-color-bar" style="background:${group.color};"></span>
                <strong>${escapeHtml(group.name)}</strong>
                <span style="font-size:0.85em; color:var(--text-secondary); margin-left:8px;">${sectionTasks.length} attivit\u00e0</span>
                <span style="float:right; display:flex; gap:4px;">
                    <button onclick="event.stopPropagation(); window.openGroupModal?.('${group.id}')" class="secondary" style="font-size:11px; padding:2px 8px;">\u270f\ufe0f Modifica</button>
                    <button onclick="event.stopPropagation(); window.deleteGroup?.('${group.id}')" class="delete" style="font-size:11px; padding:2px 8px;">\ud83d\uddd1\ufe0f</button>
                </span>
            </td>`;
            headerTr.onclick = (e) => {
                if (e.target.tagName === 'BUTTON') return;
                const isCollapsed = headerTr.dataset.collapsed === 'true';
                tbody.querySelectorAll(`[data-group-member="${group.id}"]`).forEach(r => {
                    r.style.display = isCollapsed ? '' : 'none';
                });
                headerTr.dataset.collapsed = isCollapsed ? 'false' : 'true';
            };
            tbody.appendChild(headerTr);
        }

        sectionTasks.forEach(task => {
        const tr = document.createElement('tr');
        if (group) tr.setAttribute('data-group-member', group.id);

        const isCompleted = task.status === 'completata' || task.completion >= 100;
        const isOverdue   = !isCompleted && task.endDate && task.endDate < today;

        let rowClass = '';
        if (task.flexibleDate) {
            rowClass = 'task-flexible-date';
        } else if (isOverdue) {
            rowClass = 'status-overdue';
        } else if (isCompleted) {
            rowClass = 'status-completed';
        } else if (task.status === 'annullata') {
            rowClass = 'status-cancelled';
        } else if (task.status === 'in-ritardo') {
            rowClass = 'status-in-ritardo';
        } else if (task.status === 'pausa') {
            rowClass = 'status-paused';
        } else if (task.status === 'in-corso') {
            rowClass = 'status-in-progress';
        } else if (!task.resources || task.resources.length === 0) {
            rowClass = 'status-not-assigned';
        }
        tr.className    = rowClass;
        tr.style.cursor = 'pointer';
        tr.onclick      = function(e) {
            if (!e.target.closest('.action-buttons') && e.target.tagName !== 'INPUT') {
                window.openTaskModal?.(task.id);
            }
        };

        // Risorse
        let resourcesStr = '-';
        if (task.resources && task.resources.length > 0) {
            resourcesStr = task.resources.map(r => {
                const res = state.resources.find(res => res.id == r.resourceId);
                return res ? `${res.firstName} ${res.lastName} (${r.percentage}%)` : '';
            }).filter(s => s).join(', ');
        }

        // Select status inline
        const statusSelectHtml = `<select onclick="event.stopPropagation()" onchange="window.changeTaskStatus?.(${task.id}, this.value)" style="font-size:12px; padding:2px 4px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-primary); cursor:pointer;">
            ${statusOptions.map(o => `<option value="${o.value}"${(task.status || '') === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
        </select>`;

        // Stringa collegamenti
        let linksStr = '-';
        const links  = [];
        if (task.startLinkedTo) {
            let [type, id] = task.startLinkedTo.includes(':')
                ? task.startLinkedTo.split(':')
                : task.startLinkedTo.split('-');
            if (type === 'start' || type === 'end') type = 'task';
            if (type === 'milestone') {
                const ms = project.milestones?.find(m => m.id == id);
                if (ms) {
                    const off = task.startOffset ? ` ${task.startOffset > 0 ? '+' : ''}${task.startOffset}gg` : '';
                    links.push(`Inizio: 📍${ms.name}${off}`);
                }
            } else if (type === 'task') {
                const lt = project.tasks?.find(t => t.id == id);
                if (lt) {
                    const off = task.startOffset ? ` ${task.startOffset > 0 ? '+' : ''}${task.startOffset}gg` : '';
                    links.push(`Inizio: 📋${lt.name}${off}`);
                }
            }
        }
        if (task.endLinkedTo) {
            let [type, id] = task.endLinkedTo.includes(':')
                ? task.endLinkedTo.split(':')
                : task.endLinkedTo.split('-');
            if (type === 'start' || type === 'end') type = 'task';
            if (type === 'milestone') {
                const ms = project.milestones?.find(m => m.id == id);
                if (ms) {
                    const off = task.endOffset ? ` ${task.endOffset > 0 ? '+' : ''}${task.endOffset}gg` : '';
                    links.push(`Fine: 📍${ms.name}${off}`);
                }
            } else if (type === 'task') {
                const lt = project.tasks?.find(t => t.id == id);
                if (lt) {
                    const off = task.endOffset ? ` ${task.endOffset > 0 ? '+' : ''}${task.endOffset}gg` : '';
                    links.push(`Fine: 📋${lt.name}${off}`);
                }
            }
        }
        if (links.length > 0) linksStr = links.join(' | ');

        // Indicatori
        const taskDelay   = projectDelays.find(td => td.task.id === task.id);
        const delayIndicator = taskDelay
            ? `<span style="color: #ff6b6b; font-weight: bold;" title="Ritardo di ${taskDelay.delayDays} giorni per assenze: ${taskDelay.affectedResources}"> ⚠️ ${taskDelay.delayDays}gg</span>`
            : '';
        const flexibleIndicator = task.flexibleDate
            ? `<span style="color: var(--info-color); font-weight: bold; margin-left: 5px;" title="Attività con data flessibile">💡</span>`
            : '';
        const notesIndicator = task.notes?.trim()
            ? `<span style="color: var(--warning-color); margin-left: 5px; cursor: help;" title="${escapeHtml(task.notes).replace(/\n/g, '&#10;')}">📝</span>`
            : '';

        // Differenza giorni previsti/effettivi
        let daysDiffIndicator = '';
        if (task.startedAt && task.completedAt && task.duration) {
            const actualDays  = countWorkingDaysBetween(task.startedAt, task.completedAt, task.saturdayWork, task.sundayWork, task.holidayWork, task.resources);
            const plannedDays = task.duration;
            const diff        = actualDays - plannedDays;
            if (diff > 0) {
                daysDiffIndicator = `<span style="color: #f44336; font-size: 0.85em;" title="Previsti: ${plannedDays}gg, Effettivi: ${actualDays}gg"> ⚠️+${diff}gg</span>`;
            } else if (diff < 0) {
                daysDiffIndicator = `<span style="color: #4CAF50; font-size: 0.85em;" title="Previsti: ${plannedDays}gg, Effettivi: ${actualDays}gg"> ✅${diff}gg</span>`;
            } else {
                daysDiffIndicator = `<span style="color: var(--text-tertiary); font-size: 0.85em;" title="Previsti: ${plannedDays}gg, Effettivi: ${actualDays}gg"> ✅ ok</span>`;
            }
        } else if (task.startedAt && !task.completedAt && task.duration) {
            const todayStr     = formatDateLocal(new Date());
            const elapsedDays  = countWorkingDaysBetween(task.startedAt, todayStr, task.saturdayWork, task.sundayWork, task.holidayWork, task.resources);
            const plannedDays  = task.duration;
            if (elapsedDays > plannedDays) {
                daysDiffIndicator = `<span style="color: #ff9800; font-size: 0.85em;" title="Avviata: ${task.startedAt}, Giorni lavorativi trascorsi: ${elapsedDays}, Previsti: ${plannedDays}"> ⏱️+${elapsedDays - plannedDays}gg</span>`;
            }
        }

        const cancelledStyle = task.status === 'annullata' ? 'style="text-decoration: line-through; color: #666;"' : '';

        // Checkbox per analisi risorse (solo task non assegnati)
        const isUnassigned = !task.resources || task.resources.length === 0 ||
            !task.resources.some(r => r.resourceId && state.resources.some(res => res.id == r.resourceId));
        const checkboxCell = isUnassigned
            ? `<td style="text-align:center; padding:3px; width:22px;" onclick="event.stopPropagation()"><input type="checkbox" ${state.selectedTasksForAnalysis.has(task.id) ? 'checked' : ''} onclick="event.stopPropagation()" onchange="window.toggleTaskAnalysisSelection?.(${task.id}, this.checked)" title="Seleziona per analisi risorse" style="cursor:pointer;"></td>`
            : '<td></td>';

        tr.innerHTML = checkboxCell + `
            <td ${cancelledStyle}>${escapeHtml(task.name)} ${delayIndicator}${flexibleIndicator}${notesIndicator}</td>
            <td ${cancelledStyle}>${escapeHtml(resourcesStr)}</td>
            <td ${cancelledStyle}>${task.startDate || '-'}</td>
            <td ${cancelledStyle}>${task.endDate || '-'}</td>
            <td ${cancelledStyle}>${task.duration} giorni${daysDiffIndicator}</td>
            <td ${cancelledStyle}>${getLocationBadgeHtml(task)}</td>
            <td ${cancelledStyle}>${linksStr}</td>
            <td ${cancelledStyle}>${task.completion}%</td>
            <td>${statusSelectHtml}</td>
            <td class="action-buttons">
                <button onclick="window.openTaskModal?.(${task.id})" class="secondary">✏️ Modifica</button>
                <button onclick="window.openSplitTaskModal?.(${task.id})" class="secondary" title="Spezza o duplica attività">✂️ Spezza/Duplica</button>
                <button onclick="window.openCopyTaskModal?.(${task.id}, ${state.currentProjectId})" class="secondary" title="Copia su altri progetti">📋 Copia</button>
                <button onclick="window.deleteTask?.(${task.id})" class="delete">🗑️ Elimina</button>
            </td>
        `;
        tbody.appendChild(tr);
        }); // end sectionTasks.forEach
    }); // end tasksToRender.forEach

    // Riepilogo giorni progetto
    if (typeof window.renderProjectDaysSummary === 'function') window.renderProjectDaysSummary();
    // Barra selezione (preserva selezione corrente)
    updateTaskSelectionBar();
}

// ─── Avviso assenze nel modal ─────────────────────────────────────────────────

/**
 * Mostra (o nasconde) il banner di avviso assenze nel modal attività.
 * @param {string} startDate     - data inizio "YYYY-MM-DD"
 * @param {string} endDate       - data fine   "YYYY-MM-DD"
 * @param {Array}  taskResources - array di {resourceId, ...}
 */
export function showAbsenceWarning(startDate, endDate, taskResources) {
    const warningContainer = document.getElementById('absenceWarningContainer');
    const warningText      = document.getElementById('absenceWarningText');
    if (!warningContainer || !warningText) return;

    if (!startDate || !endDate || !taskResources || taskResources.length === 0) {
        warningContainer.style.display = 'none';
        return;
    }

    const start = new Date(startDate + 'T00:00:00');
    const end   = new Date(endDate   + 'T00:00:00');

    const resourcesWithAbsences = [];
    taskResources.forEach(tr => {
        const resource = state.resources.find(r => r.id == tr.resourceId);
        if (!resource || !resource.absences || resource.absences.length === 0) return;

        const absencesInPeriod = resource.absences.filter(abs => {
            const absStart = new Date(abs.start + 'T00:00:00');
            const absEnd   = new Date(abs.end   + 'T00:00:00');
            return absStart <= end && absEnd >= start;
        });

        if (absencesInPeriod.length > 0) {
            resourcesWithAbsences.push({
                name:     `${resource.firstName} ${resource.lastName}`,
                absences: absencesInPeriod
            });
        }
    });

    if (resourcesWithAbsences.length === 0) {
        warningContainer.style.display = 'none';
        return;
    }

    let message = '';
    if (resourcesWithAbsences.length === 1) {
        const res = resourcesWithAbsences[0];
        message = `La risorsa ${res.name} ha ${res.absences.length} periodo/i di assenza durante questa attività.`;
    } else {
        message = `${resourcesWithAbsences.length} risorse hanno assenze durante questa attività:`;
        resourcesWithAbsences.forEach(res => { message += ` ${res.name} (${res.absences.length}),`; });
        message = message.slice(0, -1) + '.';
    }

    if (taskResources.length > 1) {
        message += ' Le date sono state calcolate saltando solo i giorni in cui TUTTE le risorse sono assenti.';
    } else {
        message += ' Le date sono state calcolate tenendo conto delle assenze.';
    }

    warningText.textContent        = message;
    warningContainer.style.display = 'block';
}

// ─── Email attività ───────────────────────────────────────────────────────────

/**
 * Genera un'email con i dettagli del task attualmente aperto nel modal,
 * copia il contenuto formattato negli appunti e scarica un file .ics.
 */
export async function sendTaskEmail() {
    const f = i => document.getElementById(i);

    const taskName    = f('taskName')?.value;
    const startDate   = f('taskStartDate')?.value;
    const endDate     = f('taskEndDate')?.value;
    const duration    = f('taskDuration')?.value;
    const completion  = f('taskCompletion')?.value;
    const status      = f('taskStatus')?.value;
    const notes       = f('taskNotes')?.value;
    const flexibleDate = f('taskFlexibleDate')?.checked || false;
    const nightWork   = f('taskNightWork')?.value.trim();

    const project     = _currentProject();
    const projectName = project ? `${project.client} (${project.code})` : 'N/A';

    // Risorse
    let resourcesText = '';
    document.querySelectorAll('.resource-item').forEach(div => {
        const select = div.querySelector('select');
        const input  = div.querySelector('input[type="number"]');
        if (select && input && select.value) {
            const res = state.resources.find(r => r.id == select.value);
            if (res) resourcesText += `  - ${res.firstName} ${res.lastName}: ${input.value}%\n`;
        }
    });
    if (!resourcesText) resourcesText = '  Nessuna risorsa assegnata\n';

    const checklistItems = typeof getChecklistItems === 'function' ? getChecklistItems() : [];

    // Stato leggibile
    const statusText = {
        '':           'Da Fare',
        'in-corso':   'In Corso',
        'in-ritardo': 'In Ritardo',
        'pausa':      'In Pausa',
        'completata': 'Completata',
        'annullata':  'Annullata'
    }[status] || 'Da Fare';

    // Location
    const locationType = f('taskLocationType')?.value || '';
    const plantId      = f('taskPlantId')?.value || '';
    let locationText   = '';
    if (locationType === 'sede')         locationText = 'In Sede';
    else if (locationType === 'cliente') {
        const plant = state.plants.find(p => p.id == plantId);
        locationText = 'Presso Cliente' + (plant ? ` - ${plant.name} (${plant.address || ''})` : '');
    } else if (locationType === 'remoto') locationText = 'Da Remoto';
    else locationText = 'Non specificata';

    const subject = `Attività: ${taskName} - ${projectName}`;

    // Note in HTML (usa marked se disponibile)
    let notesHtml = '<em>Nessuna nota</em>';
    if (notes && typeof marked !== 'undefined') {
        notesHtml = marked.parse(notes);
    } else if (notes) {
        notesHtml = `<pre>${escapeHtml(notes)}</pre>`;
    }

    // Checklist HTML
    let checklistHtml = '';
    if (checklistItems.length > 0) {
        checklistHtml = '<h3 style="margin:12px 0 6px;">Checklist</h3><ul style="list-style:none;padding-left:0;">';
        checklistItems.forEach(item => {
            const icon  = item.completed ? '☑' : '☐';
            const style = item.completed ? 'text-decoration:line-through;color:#888;' : '';
            checklistHtml += `<li style="${style}">${icon} ${escapeHtml(item.text)}</li>`;
        });
        checklistHtml += '</ul>';
    }

    // Risorse HTML
    const resLines   = resourcesText.trim().split('\n').filter(l => l.trim());
    const resourcesHtml = resLines.length > 0
        ? '<ul>' + resLines.map(l => `<li>${escapeHtml(l.replace(/^\s*-\s*/, ''))}</li>`).join('') + '</ul>'
        : '<em>Nessuna risorsa assegnata</em>';

    const htmlBody = `
        <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:14px;color:#333;">
            <h2 style="border-bottom:2px solid #4CAF50;padding-bottom:6px;">Dettagli Attività</h2>
            <table style="border-collapse:collapse;margin:10px 0;">
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Nome:</td><td>${escapeHtml(taskName)}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Progetto:</td><td>${escapeHtml(projectName)}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Inizio:</td><td>${startDate || 'Non definita'}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Fine:</td><td>${endDate || 'Non definita'}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Durata:</td><td>${duration} giorni lavorativi</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Data Flessibile:</td><td>${flexibleDate ? 'Sì' : 'No'}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Sede:</td><td>${escapeHtml(locationText)}</td></tr>
                ${nightWork ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">🌙 Lavoro Notturno:</td><td>${escapeHtml(nightWork)}</td></tr>` : ''}
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Stato:</td><td>${statusText}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Completamento:</td><td>${completion}%</td></tr>
            </table>
            <h3 style="margin:12px 0 6px;">Risorse Assegnate</h3>
            ${resourcesHtml}
            ${checklistHtml}
            <h3 style="margin:12px 0 6px;">Note</h3>
            <div style="background:#f9f9f9;border-left:3px solid #4CAF50;padding:8px 12px;margin:6px 0;">${notesHtml}</div>
        </div>`;

    let checklistText = '';
    if (checklistItems.length > 0) {
        checklistText = '\nChecklist:\n';
        checklistItems.forEach(item => {
            checklistText += `  ${item.completed ? '[✓]' : '[ ]'} ${item.text}\n`;
        });
    }
    const plainBody =
        `Dettagli Attività\n================\n\n` +
        `Nome: ${taskName}\nProgetto: ${projectName}\n\n` +
        `Date:\n  - Inizio: ${startDate || 'Non definita'}\n  - Fine: ${endDate || 'Non definita'}\n` +
        `  - Durata: ${duration} giorni lavorativi\n  - Data Flessibile: ${flexibleDate ? 'Sì' : 'No'}\n\n` +
        `Sede: ${locationText}\n` +
        (nightWork ? `🌙 Lavoro Notturno: ${nightWork}\n` : '') +
        `Stato: ${statusText}\nCompletamento: ${completion}%\n\nRisorse Assegnate:\n${resourcesText}\n` +
        checklistText +
        `Note:\n${notes || 'Nessuna nota'}\n`;

    // Genera file .ics
    const icsContent = _generateICS({ taskName, projectName, startDate, endDate, duration, flexibleDate, status, completion, locationText, locationType, plantId: f('taskPlantId')?.value, notes, checklistItems, resourcesText });
    if (icsContent) {
        const icsBlob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
        const icsUrl  = URL.createObjectURL(icsBlob);
        const icsLink = document.createElement('a');
        icsLink.href     = icsUrl;
        icsLink.download = `${taskName.replace(/[^a-zA-Z0-9àèéìòùÀÈÉÌÒÙ\s_-]/g, '').replace(/\s+/g, '_')}.ics`;
        document.body.appendChild(icsLink);
        icsLink.click();
        document.body.removeChild(icsLink);
        URL.revokeObjectURL(icsUrl);
    }

    // Copia negli appunti
    try {
        const blob = new Blob([htmlBody], { type: 'text/html' });
        const ci   = new ClipboardItem({ 'text/html': blob, 'text/plain': new Blob([plainBody], { type: 'text/plain' }) });
        await navigator.clipboard.write([ci]);
        const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainBody)}`;
        window.location.href = mailtoLink;
        setTimeout(() => {
            alert('✅ Il contenuto formattato è stato copiato negli appunti.\n📅 Il file .ics per il calendario è stato scaricato.\n\nNel client email:\n1. Usa Ctrl+V per incollare la versione formattata\n2. Allega il file .ics scaricato per aggiungere l\'evento al calendario');
        }, 500);
    } catch {
        const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainBody)}`;
        window.location.href = mailtoLink;
    }

    // Salva data invio email
    if (state.editingTaskId && project) {
        const task = project.tasks?.find(t => t.id === state.editingTaskId);
        if (task) {
            task.emailSentAt = formatDateLocal(new Date());
            await db.save('projects', project);
            const emailSentDisplay = document.getElementById('taskEmailSentDisplay');
            if (emailSentDisplay) {
                const [y, m, d] = task.emailSentAt.split('-');
                emailSentDisplay.innerHTML = `Inviata: ${d}/${m}/${y} <span onclick="window.clearEmailSentDate?.()" style="cursor:pointer; margin-left:4px; color:#ff6b6b;" title="Cancella data invio">✕</span>`;
            }
        }
    }
}

/** Genera il contenuto di un file .ics per il task. */
function _generateICS({ taskName, projectName, startDate, endDate, duration, flexibleDate, status, completion, locationText, locationType, plantId, notes, checklistItems, resourcesText }) {
    if (!startDate || !endDate) return null;

    const formatICSDate = str => str.replace(/-/g, '');
    const icsStart = formatICSDate(startDate);
    const endDateObj = new Date(endDate);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const icsEnd = endDateObj.toISOString().slice(0, 10).replace(/-/g, '');

    const now     = new Date();
    const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const uid     = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@gutilities`;

    let description = `Progetto: ${projectName}\\nStato: ${status || 'Da Fare'}\\nCompletamento: ${completion}%\\nDurata: ${duration} giorni lavorativi\\nData Flessibile: ${flexibleDate ? 'Sì' : 'No'}\\nSede: ${locationText}\\n\\n`;
    description += `Risorse Assegnate:\\n`;
    if (resourcesText?.trim()) {
        resourcesText.trim().split('\n').forEach(l => { description += `${l.trim()}\\n`; });
    } else {
        description += `Nessuna risorsa assegnata\\n`;
    }
    if (checklistItems?.length > 0) {
        description += `\\nChecklist:\\n`;
        checklistItems.forEach(item => { description += `${item.completed ? '[✓]' : '[ ]'} ${item.text}\\n`; });
    }
    if (notes) description += `\\nNote:\\n${notes.replace(/\n/g, '\\n')}`;

    let icsLocation = locationText;
    let icsGeo      = '';
    let isOutOfOffice = false;
    if (locationType === 'cliente') {
        const plant = state.plants.find(p => p.id == plantId);
        if (plant) {
            icsLocation = (plant.name ? plant.name + ' - ' : '') + (plant.address || '');
            if (plant.lat && plant.lng) icsGeo = `${plant.lat};${plant.lng}`;
        }
        isOutOfOffice = true;
    }

    const foldLine = (key, value) => {
        let line = `${key}:${value}`;
        let result = '';
        while (line.length > 75) { result += line.substring(0, 75) + '\r\n '; line = line.substring(75); }
        return result + line;
    };

    const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//gUtilities//ProjectPlanner//IT',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
        foldLine('UID', uid), foldLine('DTSTAMP', dtstamp),
        `DTSTART;VALUE=DATE:${icsStart}`, `DTEND;VALUE=DATE:${icsEnd}`,
        foldLine('SUMMARY', taskName + ' - ' + projectName),
        foldLine('DESCRIPTION', description),
        foldLine('LOCATION', icsLocation)
    ];
    if (icsGeo) lines.push(`GEO:${icsGeo}`);
    lines.push(
        `X-MICROSOFT-CDO-BUSYSTATUS:${isOutOfOffice ? 'OOF' : 'BUSY'}`,
        `STATUS:${status === 'completata' ? 'COMPLETED' : 'CONFIRMED'}`,
        'TRANSP:OPAQUE',
        'BEGIN:VALARM',
        'TRIGGER;VALUE=DATE-TIME:' + (() => {
            if (!startDate) return '';
            const d = new Date(startDate);
            d.setDate(d.getDate() - 1);
            d.setHours(14, 10, 0, 0);
            return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        })(),
        'ACTION:DISPLAY',
        foldLine('DESCRIPTION', 'Promemoria: ' + taskName),
        'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'
    );

    return lines.join('\r\n');
}

/** Rimuove la data di invio email dal task attualmente aperto. */
export async function clearEmailSentDate() {
    if (!state.editingTaskId) return;
    const project = _currentProject();
    if (!project) return;
    const task = project.tasks?.find(t => t.id === state.editingTaskId);
    if (task) {
        task.emailSentAt = null;
        await db.save('projects', project);
        const emailSentDisplay = document.getElementById('taskEmailSentDisplay');
        if (emailSentDisplay) emailSentDisplay.innerHTML = '';
    }
}

// ─── Analisi risorse per attività non assegnate ────────────────────────────────

/**
 * Seleziona/deseleziona un task per l'analisi risorse disponibili.
 * @param {number} taskId
 * @param {boolean} checked
 */
export function toggleTaskAnalysisSelection(taskId, checked) {
    if (checked) {
        state.selectedTasksForAnalysis.add(taskId);
    } else {
        state.selectedTasksForAnalysis.delete(taskId);
    }
    updateTaskSelectionBar();
}

/** Aggiorna la barra di selezione attività per l'analisi risorse. */
export function updateTaskSelectionBar() {
    const bar      = document.getElementById('taskSelectionBar');
    const countEl  = document.getElementById('taskSelectionCount');
    const panel    = document.getElementById('analyzeResourcesPanel');
    if (!bar) return;

    const count = state.selectedTasksForAnalysis.size;
    if (count > 0) {
        bar.style.display   = 'flex';
        if (countEl) countEl.textContent = `${count} attività selezionat${count === 1 ? 'a' : 'e'}`;
    } else {
        bar.style.display = 'none';
        if (panel) panel.style.display = 'none';
    }
}

/** Deseleziona tutte le attività e nasconde la barra di selezione. */
export function clearTaskAnalysisSelection() {
    state.selectedTasksForAnalysis.clear();
    updateTaskSelectionBar();
    renderTasks();
}

/**
 * Analizza la disponibilità delle risorse visibili per le attività selezionate.
 * Mostra un pannello con il numero di giorni di sovrapposizione per risorsa.
 */
export function analizzaRisorsePerAttivita() {
    const project = _currentProject();
    if (!project) return;

    const selectedTasks = [...state.selectedTasksForAnalysis]
        .map(id => project.tasks?.find(t => t.id === id))
        .filter(t => t && t.startDate && t.endDate);

    if (selectedTasks.length === 0) {
        alert("Seleziona almeno un'attività con date definite (inizio e fine) per l'analisi.");
        return;
    }

    const visibleResources = state.resources.filter(r => !r.hidden);
    if (visibleResources.length === 0) {
        alert('Nessuna risorsa visibile. Rendi visibili le risorse nella tab Risorse.');
        return;
    }

    const today  = formatDateLocal(new Date());
    const results = visibleResources.map(resource => {
        let overlapDays = 0;

        selectedTasks.forEach(task => {
            let current = new Date(task.startDate + 'T00:00:00');
            const end   = new Date(task.endDate   + 'T00:00:00');

            while (current <= end) {
                const dateStr = formatDateLocal(current);
                const dow     = current.getDay();
                const isWeekend = dow === 0 || dow === 6;
                if (!isWeekend) {
                    // Controlla se la risorsa ha già un'attività in questo giorno
                    const isBusy = state.projects.some(proj =>
                        (proj.tasks || []).some(t => {
                            if (t.id === task.id) return false;
                            if (!t.startDate || !t.endDate) return false;
                            if (t.status === 'completata' || t.status === 'annullata') return false;
                            const tEnd = t.endDate >= today ? t.endDate : null;
                            if (!tEnd) return false;
                            if (dateStr < t.startDate || dateStr > t.endDate) return false;
                            return t.resources?.some(r => r.resourceId == resource.id);
                        })
                    );
                    if (isBusy) overlapDays++;
                }
                current.setDate(current.getDate() + 1);
            }
        });

        return { resource, overlapDays };
    });

    // Ordina per sovrapposizione crescente (meglio disponibili prima)
    results.sort((a, b) => a.overlapDays - b.overlapDays);

    // Mostra pannello risultati
    let panel = document.getElementById('analyzeResourcesPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'analyzeResourcesPanel';
        panel.style.cssText = 'margin:12px 0; padding:12px; background:var(--bg-secondary); border-radius:8px; border:1px solid var(--border-color);';
        const bar = document.getElementById('taskSelectionBar');
        if (bar) bar.parentNode.insertBefore(panel, bar.nextSibling);
    }

    panel.style.display = 'block';
    panel.innerHTML = `
        <h4 style="margin:0 0 8px; font-size:13px;">Analisi disponibilità risorse (${selectedTasks.length} attività selezionate)</h4>
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead><tr>
                <th style="text-align:left; padding:4px 8px; border-bottom:1px solid var(--border-color);">Risorsa</th>
                <th style="text-align:center; padding:4px 8px; border-bottom:1px solid var(--border-color);">Giorni sovrapposti</th>
                <th style="text-align:left; padding:4px 8px; border-bottom:1px solid var(--border-color);">Disponibilità</th>
            </tr></thead>
            <tbody>
                ${results.map(({ resource, overlapDays }) => {
                    const color = overlapDays === 0 ? '#4CAF50' : overlapDays < 3 ? '#ff9800' : '#f44336';
                    const label = overlapDays === 0 ? '✅ Libera' : `⚠️ ${overlapDays} gg occupati`;
                    return `<tr>
                        <td style="padding:3px 8px;">${escapeHtml(resource.firstName)} ${escapeHtml(resource.lastName)}</td>
                        <td style="text-align:center; padding:3px 8px; color:${color}; font-weight:bold;">${overlapDays}</td>
                        <td style="padding:3px 8px; color:${color};">${label}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
        <button onclick="window.closeAnalyzeResourcesPanel?.()" class="secondary" style="margin-top:8px; font-size:12px;">✕ Chiudi</button>
    `;
}

// ─── Gestione Gruppi Attività ─────────────────────────────────────────────────

/** Aggiorna il <select id="taskGroupId"> con i gruppi del progetto corrente. */
function populateGroupSelect() {
    const sel = document.getElementById('taskGroupId');
    if (!sel) return;
    const project = _currentProject();
    const groups  = project?.taskGroups || [];
    sel.innerHTML = '<option value="">-- Nessun Gruppo --</option>' +
        groups.sort((a, b) => (a.order || 0) - (b.order || 0))
              .map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`)
              .join('');
}

/**
 * Apre il modal per creare/modificare gruppi.
 * @param {string|null} groupId - id del gruppo da modificare, o null per creazione
 */
export function openGroupModal(groupId = null) {
    const f = i => document.getElementById(i);
    const project = _currentProject();
    if (!project) return;
    if (!project.taskGroups) project.taskGroups = [];

    if (groupId) {
        const g = project.taskGroups.find(g => g.id === groupId);
        if (g) {
            f('taskGroupModalTitle').textContent = 'Modifica Gruppo';
            f('taskGroupId_edit').value = g.id;
            f('taskGroupName').value    = g.name;
            f('taskGroupColor').value   = g.color || '#4a90d9';
        }
    } else {
        f('taskGroupModalTitle').textContent = 'Nuovo Gruppo';
        f('taskGroupId_edit').value = '';
        f('taskGroupName').value    = '';
        f('taskGroupColor').value   = '#4a90d9';
    }
    _renderGroupsList();
    openModal(document.getElementById('taskGroupModal'));
}

/** Chiude il modal gruppi. */
export function closeGroupModal() {
    closeModal(document.getElementById('taskGroupModal'));
}

/** Salva (crea o aggiorna) un gruppo. */
export async function saveGroup() {
    const f = i => document.getElementById(i);
    const name   = f('taskGroupName')?.value.trim();
    const color  = f('taskGroupColor')?.value || '#4a90d9';
    const editId = f('taskGroupId_edit')?.value || null;
    if (!name) { alert('Inserisci un nome per il gruppo'); return; }

    const project = _currentProject();
    if (!project) return;
    if (!project.taskGroups) project.taskGroups = [];

    if (editId) {
        const idx = project.taskGroups.findIndex(g => g.id === editId);
        if (idx >= 0) project.taskGroups[idx] = { ...project.taskGroups[idx], name, color };
    } else {
        project.taskGroups.push({
            id:    `grp-${Date.now()}`,
            name,
            color,
            order: project.taskGroups.length
        });
    }
    await db.save('projects', project);
    _renderGroupsList();
    populateGroupSelect();
    f('taskGroupName').value     = '';
    f('taskGroupId_edit').value  = '';
    f('taskGroupModalTitle').textContent = 'Nuovo Gruppo';
    f('taskGroupColor').value    = '#4a90d9';
    renderTasks();
}

/**
 * Elimina un gruppo. I task assegnati perdono il groupId.
 * @param {string} groupId
 */
export async function deleteGroup(groupId) {
    if (!confirm('Eliminare questo gruppo? Le attività assegnate non saranno eliminate.')) return;
    const project = _currentProject();
    if (!project) return;
    project.taskGroups = (project.taskGroups || []).filter(g => g.id !== groupId);
    (project.tasks || []).forEach(t => { if (t.groupId === groupId) t.groupId = null; });
    await db.save('projects', project);
    renderTasks();
    _renderGroupsList();
    populateGroupSelect();
}

/** Renderizza la lista dei gruppi nel modal gruppi. */
function _renderGroupsList() {
    const container = document.getElementById('taskGroupsList');
    if (!container) return;
    const project = _currentProject();
    const groups  = project?.taskGroups || [];
    if (groups.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary); font-size:0.9em;">Nessun gruppo creato.</p>';
        return;
    }
    container.innerHTML = groups
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(g => `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-color);">
                <span style="display:inline-block; width:14px; height:14px; border-radius:3px; background:${g.color}; flex-shrink:0;"></span>
                <span style="flex:1; font-size:0.9em;">${escapeHtml(g.name)}</span>
                <button onclick="window.openGroupModal?.('${g.id}')" class="secondary" style="font-size:11px; padding:2px 8px;">\u270f\ufe0f</button>
                <button onclick="window.deleteGroup?.('${g.id}')" class="delete" style="font-size:11px; padding:2px 8px;">\ud83d\uddd1\ufe0f</button>
            </div>
        `).join('');
}
