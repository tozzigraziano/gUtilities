/**
 * js/modules/templates.js
 *
 * Gestione template riutilizzabili: CRUD template, milestone di template,
 * task di template e applicazione di un template a un progetto.
 *
 * Dipendenze v2:
 *   - ../db.js       → db.save, db.remove
 *   - ../state.js    → state.templates, state.setTemplates, state.projects,
 *                       state.resources, state.currentProjectId, state.setCurrentProjectId
 *   - ../helpers.js  → openModal, closeModal, escapeHtml, formatDateLocal,
 *                       calculateEndDateForTask
 *   - ./holidays.js  → calculateHolidays, renderHolidays
 *
 * Per evitare dipendenze circolari con tasks.js, applyTaskLinks viene
 * richiamato tramite window.applyTaskLinks (esposto da app.js).
 * Altre viste dipendenti vengono aggiornate via CustomEvent 'app:viewRefresh'.
 */

import * as db    from '../db.js';
import * as state from '../state.js';
import {
    openModal, closeModal,
    escapeHtml, formatDateLocal,
    calculateEndDateForTask
} from '../helpers.js';
import { calculateHolidays, renderHolidays } from './holidays.js';

// ─── Stato locale ──────────────────────────────────────────────────────────────
let _currentTemplateId          = null;
let _editingTemplateMilestoneId = null;
let _editingTemplateTaskId      = null;
let _editingTemplateGroupId     = null;

// ─── Helper interno ────────────────────────────────────────────────────────────

function _triggerViewRefresh(views = []) {
    window.dispatchEvent(new CustomEvent('app:viewRefresh', { detail: { views } }));
}

// ─── Modal Template ────────────────────────────────────────────────────────────

/** Apre il modal per creare o modificare un template. */
export function openTemplateModal(id = null) {
    _currentTemplateId = id;
    const modal = document.getElementById('templateModal');
    const title = document.getElementById('templateModalTitle');

    if (id) {
        title.textContent = 'Modifica Template';
        const template = state.templates.find(t => t.id === id);
        if (template) document.getElementById('templateName').value = template.name;
    } else {
        title.textContent = 'Nuovo Template';
        _clearTemplateForm();
    }

    openModal(modal);
}

/** Chiude il modal template. */
export function closeTemplateModal() {
    closeModal(document.getElementById('templateModal'));
    _clearTemplateForm();
}

function _clearTemplateForm() {
    _currentTemplateId = null;
    document.getElementById('templateName').value = '';
}

// ─── CRUD Template ─────────────────────────────────────────────────────────────

/** Salva (crea o aggiorna) un template. */
export async function saveTemplate() {
    const templateName = document.getElementById('templateName').value.trim();
    if (!templateName) { alert('Nome template obbligatorio'); return; }

    const existing = _currentTemplateId
        ? state.templates.find(t => t.id === _currentTemplateId)
        : null;

    const template = {
        id:         _currentTemplateId || Date.now(),
        name:       templateName,
        milestones: existing ? existing.milestones  : [],
        tasks:      existing ? existing.tasks       : [],
        taskGroups: existing ? existing.taskGroups  : []
    };

    const updatedTemplates = _currentTemplateId
        ? state.templates.map(t => t.id === _currentTemplateId ? template : t)
        : [...state.templates, template];

    state.setTemplates(updatedTemplates);
    await db.save('templates', template);

    renderTemplates();
    updateTemplateSelects();
    updateApplyTemplateSelect();
    closeTemplateModal();
}

/** Porta il template in modalità modifica (inline, non modal). */
export function editTemplate(id) {
    const template = state.templates.find(t => t.id === id);
    if (!template) return;
    _currentTemplateId = id;
    document.getElementById('templateName').value = template.name;
    document.getElementById('templateName').scrollIntoView({ behavior: 'smooth' });
}

/** Mostra la sezione dettagli (milestone + task) del template. */
export function openTemplateDetails(id) {
    _currentTemplateId = id;
    const template = state.templates.find(t => t.id === id);
    if (!template) return;

    document.getElementById('currentTemplateName').textContent = template.name;
    document.getElementById('templateDetails').style.display = 'block';
    document.querySelector('#templates > .action-bar').style.display = 'none';
    document.querySelector('#templates > h3').style.display = 'none';
    document.querySelector('#templatesTable').style.display = 'none';

    renderTemplateMilestones();
    renderTemplateTasks();
}

/** Chiude la sezione dettagli template. */
export function closeTemplateDetails() {
    document.getElementById('templateDetails').style.display = 'none';
    document.querySelector('#templates > .action-bar').style.display = 'block';
    document.querySelector('#templates > h3').style.display = 'block';
    document.querySelector('#templatesTable').style.display = 'table';
    _currentTemplateId = null;
    document.getElementById('templateName').value = '';
}

/** Elimina un template per id. */
export async function deleteTemplate(id) {
    if (!confirm('Sei sicuro di voler eliminare questo template?')) return;
    state.setTemplates(state.templates.filter(t => t.id !== id));
    await db.remove('templates', id);
    renderTemplates();
    updateTemplateSelects();
}

// ─── Applica Template a Progetto ───────────────────────────────────────────────

/**
 * Applica un template al progetto specificato, generando milestone e attività
 * a partire dalla data di inizio del progetto.
 */
export async function applyTemplateToProject(templateId, projectId, skipConfirm = false) {
    // Usa == per compatibilità string/number
    const template = state.templates.find(t => t.id == templateId);
    const project  = state.projects.find(p => p.id === projectId);

    if (!template) { console.warn('[applyTemplateToProject] Template non trovato. templateId=', templateId); return; }
    if (!project)  { console.warn('[applyTemplateToProject] Progetto non trovato. projectId=', projectId);  return; }

    if (!skipConfirm && !confirm('Questo sovrascriverà i punti di controllo e le attività del progetto. Continuare?')) return;

    // Data di inizio del progetto
    let projectStartDate = null;
    if (project.milestones && project.milestones.length > 0) {
        projectStartDate = project.milestones[0].date;
    } else if (project.tasks && project.tasks.length > 0) {
        projectStartDate = project.tasks[0].startDate;
    }
    if (!projectStartDate) projectStartDate = formatDateLocal(new Date());

    function addCalendarDays(dateStr, days) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return formatDateLocal(d);
    }

    const templateMilestones = template.milestones || [];
    const templateTasks      = template.tasks      || [];
    const templateGroups     = template.taskGroups || [];

    // Genera ID unici per il mapping template → progetto
    let idSeed = Date.now();
    const msIdMap   = {};
    const taskIdMap = {};
    const grpIdMap  = {};
    templateMilestones.forEach(m => { msIdMap[String(m.id)]   = ++idSeed; });
    templateTasks.forEach(t      => { taskIdMap[String(t.id)] = ++idSeed; });
    templateGroups.forEach(g     => { grpIdMap[String(g.id)]  = `grp-${++idSeed}`; });

    function translateLinkedTo(linkedTo) {
        if (!linkedTo) return undefined;
        const colonIdx = linkedTo.indexOf(':');
        if (colonIdx === -1) return undefined;
        const linkType = linkedTo.slice(0, colonIdx);
        const linkedId = linkedTo.slice(colonIdx + 1);
        const newId = linkType === 'milestone' ? msIdMap[linkedId] : taskIdMap[linkedId];
        return newId != null ? `${linkType}:${newId}` : undefined;
    }

    // Calcola date milestone (ordine topologico)
    const msComputed = {};
    const maxMsPasses = templateMilestones.length + 1;
    for (let pass = 0; pass < maxMsPasses; pass++) {
        let anyResolved = false;
        templateMilestones.forEach(m => {
            if (msComputed[m.id] != null) return;
            if (m.linkedTo) {
                const colonIdx = m.linkedTo.indexOf(':');
                const linkType = m.linkedTo.slice(0, colonIdx);
                const linkedId = m.linkedTo.slice(colonIdx + 1);
                if (linkType === 'milestone' && msComputed[linkedId] != null) {
                    msComputed[m.id] = addCalendarDays(msComputed[linkedId], 1 + (m.offset || 0));
                    anyResolved = true;
                }
            } else {
                msComputed[m.id] = addCalendarDays(projectStartDate, m.dayOffset || 0);
                anyResolved = true;
            }
        });
        if (!anyResolved) break;
    }
    // Fallback per milestone non risolte
    templateMilestones.forEach(m => {
        if (msComputed[m.id] == null) {
            msComputed[m.id] = addCalendarDays(projectStartDate, m.dayOffset || 0);
        }
    });

    // Copia i gruppi nel progetto
    project.taskGroups = templateGroups.map(g => ({
        id:    grpIdMap[String(g.id)],
        name:  g.name,
        color: g.color || '#4a90d9',
        order: g.order || 0
    }));

    // Costruisci milestone del progetto
    project.milestones = templateMilestones.map(m => ({
        id:   msIdMap[String(m.id)],
        name: m.name,
        date: msComputed[m.id]
    }));

    // Costruisci task del progetto
    project.tasks = templateTasks.map(t => {
        const startDate     = addCalendarDays(projectStartDate, t.startDayOffset || 0);
        const endDate       = calculateEndDateForTask(startDate, t.duration, t.saturdayWork, t.sundayWork);
        const startLinkedTo = translateLinkedTo(t.startLinkedTo);
        const endLinkedTo   = translateLinkedTo(t.endLinkedTo);
        return {
            id:           taskIdMap[String(t.id)],
            name:         t.name,
            startDate,
            duration:     t.duration,
            completion:   0,
            status:       undefined,
            saturdayWork: t.saturdayWork,
            sundayWork:   t.sundayWork,
            endDate,
            startLinkedTo: startLinkedTo || undefined,
            startOffset:   startLinkedTo ? (t.startOffset || 0) : undefined,
            endLinkedTo:   endLinkedTo   || undefined,
            endOffset:     endLinkedTo   ? (t.endOffset   || 0) : undefined,
            resources:    [],
            locationType: t.locationType || undefined,
            groupId: t.groupId && grpIdMap[String(t.groupId)] ? grpIdMap[String(t.groupId)] : null
        };
    });

    await db.save('projects', project);

    // Applica i collegamenti (cascata) tramite tasks.js esposto su window
    const prevProjectId = state.currentProjectId;
    state.setCurrentProjectId(projectId);
    if (typeof window.applyTaskLinks === 'function') window.applyTaskLinks();
    state.setCurrentProjectId(prevProjectId);

    calculateHolidays();
    renderHolidays();
    _triggerViewRefresh(['projects', 'gantt', 'resourceView']);
    alert('Template applicato con successo!');
}

/** Alias pubblico atteso da app.js. */
export const applyTemplate = applyTemplateToProject;

// ─── Render Templates ──────────────────────────────────────────────────────────

/** Renderizza la tabella dei template. */
export function renderTemplates() {
    const tbody = document.querySelector('#templatesTable tbody');
    tbody.innerHTML = '';

    state.templates.forEach(template => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(template.name)}</td>
            <td>${template.milestones ? template.milestones.length : 0}</td>
            <td>${template.tasks ? template.tasks.length : 0}</td>
            <td class="action-buttons">
                <button onclick="openTemplateModal(${template.id})" class="secondary">✏️ Modifica</button>
                <button onclick="openTemplateDetails(${template.id})" class="secondary">📋 Dettagli</button>
                <button onclick="deleteTemplate(${template.id})" class="delete">🗑️ Elimina</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/** Aggiorna il <select id="templateSelect"> con i template disponibili. */
export function updateTemplateSelects() {
    const select = document.getElementById('templateSelect');
    if (select) {
        select.innerHTML = '<option value="">-- Seleziona Template --</option>';
        state.templates.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.name;
            select.appendChild(option);
        });
    }
}

/** Aggiorna il <select id="applyTemplateSelect"> nella pagina Progetti. */
export function updateApplyTemplateSelect() {
    const select = document.getElementById('applyTemplateSelect');
    if (select) {
        select.innerHTML = '<option value="">-- Seleziona Template --</option>';
        state.templates.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.name;
            select.appendChild(option);
        });
    }
}

// ─── Modal Template Milestone ──────────────────────────────────────────────────

/** Popola il select di collegamento milestone nel form template milestone. */
function populateTemplateMilestoneLinkedSelect(excludeMilestoneId) {
    const template = state.templates.find(t => t.id === _currentTemplateId);
    if (!template) return;

    const sel = document.getElementById('templateMilestoneLinkedTo');
    sel.innerHTML = '<option value="">-- Nessun Collegamento --</option>';

    (template.milestones || []).filter(m => m.id != excludeMilestoneId).forEach(m => {
        sel.appendChild(new Option(`Dopo: 📍 ${m.name}`, `milestone:${m.id}`));
    });
    (template.tasks || []).forEach(t => {
        sel.appendChild(new Option(`Dopo: ${t.name}`, `end:${t.id}`));
    });
}

/** Apre il modal per creare/modificare una milestone di template. */
export function openTemplateMilestoneModal(id = null) {
    _editingTemplateMilestoneId = id;
    const modal = document.getElementById('templateMilestoneModal');
    const title = document.getElementById('templateMilestoneModalTitle');

    populateTemplateMilestoneLinkedSelect(id);

    if (id) {
        title.textContent = 'Modifica Punto di Controllo';
        const template = state.templates.find(t => t.id === _currentTemplateId);
        if (template) {
            const milestone = (template.milestones || []).find(m => m.id === id);
            if (milestone) {
                document.getElementById('templateMilestoneName').value    = milestone.name;
                document.getElementById('templateMilestoneDay').value     = milestone.dayOffset || 0;
                document.getElementById('templateMilestoneLinkedTo').value = milestone.linkedTo || '';
                document.getElementById('templateMilestoneOffset').value  = milestone.offset || 0;
            }
        }
    } else {
        title.textContent = 'Nuovo Punto di Controllo';
        _clearTemplateMilestoneForm();
    }

    openModal(modal);
}

/** Chiude il modal milestone template. */
export function closeTemplateMilestoneModal() {
    closeModal(document.getElementById('templateMilestoneModal'));
    _clearTemplateMilestoneForm();
}

function _clearTemplateMilestoneForm() {
    _editingTemplateMilestoneId = null;
    document.getElementById('templateMilestoneName').value    = '';
    document.getElementById('templateMilestoneDay').value     = '0';
    document.getElementById('templateMilestoneLinkedTo').value = '';
    document.getElementById('templateMilestoneOffset').value  = '0';
}

// ─── CRUD Template Milestone ───────────────────────────────────────────────────

/** Salva (crea o aggiorna) una milestone di template. */
export async function saveTemplateMilestone() {
    const name      = document.getElementById('templateMilestoneName').value.trim();
    const dayOffset = parseInt(document.getElementById('templateMilestoneDay').value) || 0;
    const linkedTo  = document.getElementById('templateMilestoneLinkedTo').value;
    const offset    = parseInt(document.getElementById('templateMilestoneOffset').value) || 0;

    if (!name) { alert('Il Nome è obbligatorio'); return; }

    const templateIndex = state.templates.findIndex(t => t.id === _currentTemplateId);
    if (templateIndex === -1) return;

    const template = { ...state.templates[templateIndex] };
    if (!template.milestones) template.milestones = [];

    const milestone = { id: _editingTemplateMilestoneId || Date.now(), name, dayOffset, linkedTo, offset };

    if (_editingTemplateMilestoneId) {
        const idx = template.milestones.findIndex(m => m.id === _editingTemplateMilestoneId);
        template.milestones = template.milestones.map((m, i) => i === idx ? milestone : m);
    } else {
        template.milestones = [...template.milestones, milestone];
    }

    const updatedTemplates = state.templates.map(t => t.id === _currentTemplateId ? template : t);
    state.setTemplates(updatedTemplates);
    await db.save('templates', template);

    renderTemplateMilestones();
    closeTemplateMilestoneModal();
}

/** Elimina una milestone di template per id. */
export async function deleteTemplateMilestone(id) {
    if (!confirm('Sei sicuro di voler eliminare questo punto di controllo?')) return;

    const templateIndex = state.templates.findIndex(t => t.id === _currentTemplateId);
    if (templateIndex === -1) return;

    const template = { ...state.templates[templateIndex] };
    template.milestones = (template.milestones || []).filter(m => m.id !== id);

    const updatedTemplates = state.templates.map(t => t.id === _currentTemplateId ? template : t);
    state.setTemplates(updatedTemplates);
    await db.save('templates', template);

    renderTemplateMilestones();
}

/** Renderizza la tabella delle milestone del template corrente. */
function renderTemplateMilestones() {
    const template = state.templates.find(t => t.id === _currentTemplateId);
    if (!template) return;

    const tbody = document.querySelector('#templateMilestonesTable tbody');
    tbody.innerHTML = '';
    if (!template.milestones) return;

    template.milestones.forEach(milestone => {
        let posDesc = '';
        if (milestone.linkedTo) {
            const [linkType, linkedId] = milestone.linkedTo.split(':');
            const ref = linkType === 'milestone'
                ? (template.milestones || []).find(m => m.id == linkedId)
                : (template.tasks      || []).find(t => t.id == linkedId);
            const refName   = ref ? ref.name : '?';
            const offsetStr = milestone.offset ? ` ${milestone.offset > 0 ? '+' : ''}${milestone.offset}gg` : '';
            posDesc = linkType === 'milestone' ? `Dopo: 📍 ${refName}${offsetStr}` : `Dopo: ${refName}${offsetStr}`;
        } else {
            posDesc = `Giorno ${milestone.dayOffset || 0}`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(milestone.name)}</td>
            <td style="font-size:11px;">${posDesc}</td>
            <td class="action-buttons">
                <button onclick="openTemplateMilestoneModal(${milestone.id})" class="secondary">✏️ Modifica</button>
                <button onclick="deleteTemplateMilestone(${milestone.id})" class="delete">🗑️ Elimina</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ─── Modal Template Task ───────────────────────────────────────────────────────

/** Popola i select di collegamento nel form template task. */
function populateTemplateLinkedSelects(excludeTaskId) {
    const template = state.templates.find(t => t.id === _currentTemplateId);
    if (!template) return;

    const startSel = document.getElementById('templateTaskStartLinkedTo');
    const endSel   = document.getElementById('templateTaskEndLinkedTo');

    startSel.innerHTML = '<option value="">-- Nessun Collegamento --</option>';
    endSel.innerHTML   = '<option value="">-- Nessun Collegamento --</option>';

    (template.milestones || []).forEach(m => {
        startSel.appendChild(new Option(`Dopo: 📍 ${m.name}`, `milestone:${m.id}`));
        endSel.appendChild(new Option(`Prima di: 📍 ${m.name}`, `milestone:${m.id}`));
    });

    (template.tasks || []).filter(t => t.id != excludeTaskId).forEach(t => {
        startSel.appendChild(new Option(`Dopo: ${t.name}`, `end:${t.id}`));
        endSel.appendChild(new Option(`Prima di: ${t.name}`, `start:${t.id}`));
    });
}

/** Apre il modal per creare/modificare un task di template. */
export function openTemplateTaskModal(id = null) {
    _editingTemplateTaskId = id;
    const modal = document.getElementById('templateTaskModal');
    const title = document.getElementById('templateTaskModalTitle');

    populateTemplateLinkedSelects(id);
    _populateTemplateGroupSelect();

    if (id) {
        title.textContent = 'Modifica Attività';
        const template = state.templates.find(t => t.id === _currentTemplateId);
        if (template) {
            const task = (template.tasks || []).find(t => t.id === id);
            if (task) {
                document.getElementById('templateTaskName').value           = task.name;
                document.getElementById('templateTaskGroupId').value        = task.groupId   || '';
                document.getElementById('templateTaskStartDay').value       = task.startDayOffset || 0;
                document.getElementById('templateTaskStartLinkedTo').value  = task.startLinkedTo  || '';
                document.getElementById('templateTaskStartOffset').value    = task.startOffset    || 0;
                document.getElementById('templateTaskDuration').value       = task.duration;
                document.getElementById('templateTaskEndLinkedTo').value    = task.endLinkedTo    || '';
                document.getElementById('templateTaskEndOffset').value      = task.endOffset      || 0;
                document.getElementById('templateTaskLocationType').value   = task.locationType   || '';
                document.getElementById('templateTaskSaturdayWork').checked = task.saturdayWork;
                document.getElementById('templateTaskSundayWork').checked   = task.sundayWork;
            }
        }
    } else {
        title.textContent = 'Nuova Attività';
        _clearTemplateTaskForm();
    }

    openModal(modal);
}

/** Chiude il modal task template. */
export function closeTemplateTaskModal() {
    closeModal(document.getElementById('templateTaskModal'));
    _clearTemplateTaskForm();
}

function _clearTemplateTaskForm() {
    _editingTemplateTaskId = null;
    document.getElementById('templateTaskName').value           = '';
    document.getElementById('templateTaskStartDay').value       = '0';
    document.getElementById('templateTaskStartLinkedTo').value  = '';
    document.getElementById('templateTaskStartOffset').value    = '0';
    document.getElementById('templateTaskDuration').value       = '1';
    document.getElementById('templateTaskEndLinkedTo').value    = '';
    document.getElementById('templateTaskEndOffset').value      = '0';
    document.getElementById('templateTaskLocationType').value   = '';
    document.getElementById('templateTaskSaturdayWork').checked = false;
    document.getElementById('templateTaskSundayWork').checked   = false;
    const _grpSel = document.getElementById('templateTaskGroupId');
    if (_grpSel) _grpSel.value = '';
}

// ─── CRUD Template Task ────────────────────────────────────────────────────────

/** Salva (crea o aggiorna) un task di template. */
export async function saveTemplateTask() {
    const name           = document.getElementById('templateTaskName').value.trim();
    const duration       = parseInt(document.getElementById('templateTaskDuration').value);
    const startDayOffset = parseInt(document.getElementById('templateTaskStartDay').value) || 0;
    const startLinkedTo  = document.getElementById('templateTaskStartLinkedTo').value;
    const startOffset    = parseInt(document.getElementById('templateTaskStartOffset').value) || 0;
    const endLinkedTo    = document.getElementById('templateTaskEndLinkedTo').value;
    const endOffset      = parseInt(document.getElementById('templateTaskEndOffset').value) || 0;
    const saturdayWork   = document.getElementById('templateTaskSaturdayWork').checked;
    const sundayWork     = document.getElementById('templateTaskSundayWork').checked;
    const locationType   = document.getElementById('templateTaskLocationType').value || undefined;
    const groupId        = document.getElementById('templateTaskGroupId')?.value || null;

    if (!name || !duration) { alert('Nome e Durata sono obbligatori'); return; }

    const templateIndex = state.templates.findIndex(t => t.id === _currentTemplateId);
    if (templateIndex === -1) return;

    const template = { ...state.templates[templateIndex] };
    if (!template.tasks) template.tasks = [];

    const task = {
        id: _editingTemplateTaskId || Date.now(),
        name, startDayOffset, startLinkedTo, startOffset,
        duration, endLinkedTo, endOffset,
        saturdayWork, sundayWork, locationType,
        groupId: groupId || null
    };

    if (_editingTemplateTaskId) {
        const idx = template.tasks.findIndex(t => t.id === _editingTemplateTaskId);
        template.tasks = template.tasks.map((t, i) => i === idx ? task : t);
    } else {
        template.tasks = [...template.tasks, task];
    }

    const updatedTemplates = state.templates.map(t => t.id === _currentTemplateId ? template : t);
    state.setTemplates(updatedTemplates);
    await db.save('templates', template);

    renderTemplateTasks();
    closeTemplateTaskModal();
}

/** Elimina un task di template per id. */
export async function deleteTemplateTask(id) {
    if (!confirm('Sei sicuro di voler eliminare questa attività?')) return;

    const templateIndex = state.templates.findIndex(t => t.id === _currentTemplateId);
    if (templateIndex === -1) return;

    const template = { ...state.templates[templateIndex] };
    template.tasks = (template.tasks || []).filter(t => t.id !== id);

    const updatedTemplates = state.templates.map(t => t.id === _currentTemplateId ? template : t);
    state.setTemplates(updatedTemplates);
    await db.save('templates', template);

    renderTemplateTasks();
}

/** Renderizza la tabella dei task del template corrente. */
function renderTemplateTasks() {
    const template = state.templates.find(t => t.id === _currentTemplateId);
    if (!template) return;

    const tbody = document.querySelector('#templateTasksTable tbody');
    tbody.innerHTML = '';
    if (!template.tasks) return;

    const locationLabels = { 'sede': '🏢 Sede', 'cliente': '🏭 Cliente', 'remoto': '🌐 Remoto' };    const groups = template.taskGroups || [];
    template.tasks.forEach(task => {
        // Descrizione inizio
        let startDesc = '';
        if (task.startLinkedTo) {
            const [linkType, linkedId] = task.startLinkedTo.split(':');
            const ref = linkType === 'milestone'
                ? (template.milestones || []).find(m => m.id == linkedId)
                : (template.tasks      || []).find(t => t.id == linkedId);
            const refName   = ref ? ref.name : '?';
            const offsetStr = task.startOffset ? ` ${task.startOffset > 0 ? '+' : ''}${task.startOffset}gg` : '';
            startDesc = linkType === 'milestone' ? `Dopo: 📍 ${refName}${offsetStr}` : `Dopo: ${refName}${offsetStr}`;
        } else {
            startDesc = `Giorno ${task.startDayOffset || 0}`;
        }

        // Descrizione fine
        let endDesc = `${task.duration} gg`;
        if (task.endLinkedTo) {
            const [linkType, linkedId] = task.endLinkedTo.split(':');
            const ref = linkType === 'milestone'
                ? (template.milestones || []).find(m => m.id == linkedId)
                : (template.tasks      || []).find(t => t.id == linkedId);
            const refName   = ref ? ref.name : '?';
            const offsetStr = task.endOffset ? ` ${task.endOffset > 0 ? '+' : ''}${task.endOffset}gg` : '';
            endDesc += ` | Prima di: ${linkType === 'milestone' ? '📍 ' : ''}${refName}${offsetStr}`;
        }

        const locationStr = task.locationType ? (locationLabels[task.locationType] || task.locationType) : '-';

        // Gruppo
        const _group     = task.groupId ? groups.find(g => g.id === task.groupId) : null;
        const _groupCell = _group
            ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${_group.color};margin-right:4px;"></span>${escapeHtml(_group.name)}`
            : '-';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(task.name)}</td>
            <td style="font-size:11px;">${_groupCell}</td>
            <td style="font-size:11px;">${startDesc}</td>
            <td style="font-size:11px;">${endDesc}</td>
            <td>${locationStr}</td>
            <td>${task.saturdayWork ? '✓' : '-'}</td>
            <td>${task.sundayWork   ? '✓' : '-'}</td>
            <td class="action-buttons">
                <button onclick="openTemplateTaskModal(${task.id})" class="secondary">✏️ Modifica</button>
                <button onclick="deleteTemplateTask(${task.id})" class="delete">🗑️ Elimina</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ─── Gruppi Template ───────────────────────────────────────────────────────────

function _populateTemplateGroupSelect() {
    const sel = document.getElementById('templateTaskGroupId');
    if (!sel) return;
    const template = state.templates.find(t => t.id === _currentTemplateId);
    const groups = template?.taskGroups || [];
    sel.innerHTML = '<option value="">-- Nessun Gruppo --</option>' +
        groups.sort((a, b) => (a.order || 0) - (b.order || 0))
              .map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`)
              .join('');
}

function _renderTemplateGroupsList() {
    const container = document.getElementById('templateGroupsList');
    if (!container) return;
    const template = state.templates.find(t => t.id === _currentTemplateId);
    const groups = template?.taskGroups || [];
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
                <button onclick="openTemplateGroupModal('${g.id}')" class="secondary" style="font-size:11px; padding:2px 8px;">✏️</button>
                <button onclick="deleteTemplateGroup('${g.id}')" class="delete" style="font-size:11px; padding:2px 8px;">🗑️</button>
            </div>
        `).join('');
}

/** Apre il modal per creare/modificare un gruppo del template corrente. */
export function openTemplateGroupModal(groupId = null) {
    _editingTemplateGroupId = groupId;
    const f = i => document.getElementById(i);
    const template = state.templates.find(t => t.id === _currentTemplateId);
    if (!template) return;
    if (!template.taskGroups) template.taskGroups = [];

    if (groupId) {
        const g = template.taskGroups.find(g => g.id === groupId);
        if (g) {
            f('templateGroupModalTitle').textContent = 'Modifica Gruppo';
            f('templateGroupId_edit').value = g.id;
            f('templateGroupName').value    = g.name;
            f('templateGroupColor').value   = g.color || '#4a90d9';
        }
    } else {
        f('templateGroupModalTitle').textContent = 'Nuovo Gruppo';
        f('templateGroupId_edit').value = '';
        f('templateGroupName').value    = '';
        f('templateGroupColor').value   = '#4a90d9';
    }
    _renderTemplateGroupsList();
    openModal(document.getElementById('templateGroupModal'));
}

/** Chiude il modal gruppi template. */
export function closeTemplateGroupModal() {
    _editingTemplateGroupId = null;
    closeModal(document.getElementById('templateGroupModal'));
}

/** Salva (crea o aggiorna) un gruppo del template. */
export async function saveTemplateGroup() {
    const f = i => document.getElementById(i);
    const name   = f('templateGroupName')?.value.trim();
    const color  = f('templateGroupColor')?.value || '#4a90d9';
    const editId = f('templateGroupId_edit')?.value || null;
    if (!name) { alert('Inserisci un nome per il gruppo'); return; }

    const templateIndex = state.templates.findIndex(t => t.id === _currentTemplateId);
    if (templateIndex === -1) return;

    const template = { ...state.templates[templateIndex] };
    if (!template.taskGroups) template.taskGroups = [];

    if (editId) {
        const idx = template.taskGroups.findIndex(g => g.id === editId);
        if (idx >= 0) template.taskGroups[idx] = { ...template.taskGroups[idx], name, color };
    } else {
        template.taskGroups.push({
            id:    `tgrp-${Date.now()}`,
            name,
            color,
            order: template.taskGroups.length
        });
    }

    const updatedTemplates = state.templates.map(t => t.id === _currentTemplateId ? template : t);
    state.setTemplates(updatedTemplates);
    await db.save('templates', template);

    _renderTemplateGroupsList();
    _populateTemplateGroupSelect();
    f('templateGroupName').value     = '';
    f('templateGroupId_edit').value  = '';
    f('templateGroupModalTitle').textContent = 'Nuovo Gruppo';
    f('templateGroupColor').value    = '#4a90d9';
    _editingTemplateGroupId = null;
}

/**
 * Elimina un gruppo del template. I task assegnati perdono il groupId.
 * @param {string} groupId
 */
export async function deleteTemplateGroup(groupId) {
    if (!confirm('Eliminare questo gruppo? Le attività assegnate non saranno eliminate.')) return;

    const templateIndex = state.templates.findIndex(t => t.id === _currentTemplateId);
    if (templateIndex === -1) return;

    const template = { ...state.templates[templateIndex] };
    template.taskGroups = (template.taskGroups || []).filter(g => g.id !== groupId);
    (template.tasks || []).forEach(t => { if (t.groupId === groupId) t.groupId = null; });

    const updatedTemplates = state.templates.map(t => t.id === _currentTemplateId ? template : t);
    state.setTemplates(updatedTemplates);
    await db.save('templates', template);

    _renderTemplateGroupsList();
    _populateTemplateGroupSelect();
    renderTemplateTasks();
}
