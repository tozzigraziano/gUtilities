/**
 * js/modules/resources.js
 *
 * Gestione completa delle risorse: CRUD, tipi risorsa, assenze, permessi,
 * calendario preview, export Markdown.
 *
 * Dipendenze v2 (tutte esistenti):
 *   - ../db.js         → db.save, db.remove, db.setSetting, db.getSetting
 *   - ../state.js      → state.resources, state.resourceTypes, ecc.
 *   - ../helpers.js    → openModal, closeModal, escapeHtml, formatDateLocal, generateId
 *   - ./holidays.js    → calculateHolidays, renderHolidays
 *
 * TODO: importare renderWarnings da './warnings.js' quando il modulo esiste.
 * TODO: importare calculateEndDateForTask da '../helpers.js' quando disponibile.
 *
 * Dispatcha l'evento CustomEvent 'app:viewRefresh' con detail.views per
 * richiedere ad app.js di aggiornare le viste dipendenti (tasks, gantt, resourceView).
 */

import * as db     from '../db.js';
import * as state  from '../state.js';
import * as Auth   from './auth.js';
import { openModal, closeModal, escapeHtml, formatDateLocal, generateId } from '../helpers.js';
import { calculateHolidays, renderHolidays } from './holidays.js';

// ─── Stato modulo ─────────────────────────────────────────────────────────────

/** Mese/anno correnti nel calendario anteprima assenze all'interno del modal. */
let resCalCurrentMonth = new Date().getMonth();
let resCalCurrentYear  = new Date().getFullYear();

// ─── Helper interno ───────────────────────────────────────────────────────────

/**
 * Notifica le viste dipendenti di aggiornarsi (gestito da app.js).
 * @param {string[]} views  Es. ['tasks', 'gantt', 'resourceView', 'warnings']
 */
function _triggerViewRefresh(views = []) {
    window.dispatchEvent(new CustomEvent('app:viewRefresh', { detail: { views } }));
}

// ─── Tipi Risorsa ─────────────────────────────────────────────────────────────

/** Popola la <select id="resourceType"> con i tipi risorsa configurati. */
export function populateResourceTypeSelect() {
    const sel = document.getElementById('resourceType');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- Seleziona --</option>';
    state.resourceTypes.forEach(rt => {
        const opt = document.createElement('option');
        opt.value    = rt.value;
        opt.textContent = rt.label;
        sel.appendChild(opt);
    });
    sel.value = currentVal;
}

/** Apre il modal di configurazione tipi risorsa. */
export function openResourceTypesSettings() {
    renderResourceTypesList();
    openModal(document.getElementById('resourceTypesSettingsModal'));
}

/** Chiude il modal di configurazione tipi risorsa. */
export function closeResourceTypesSettings() {
    closeModal(document.getElementById('resourceTypesSettingsModal'));
}

/** Conta quante risorse usano un certo tipo. */
function getResourceTypeUsageCount(typeValue) {
    return state.resources.filter(r => r.type === typeValue).length;
}

/** Renderizza la lista dei tipi risorsa nel modal settings. */
export function renderResourceTypesList() {
    const container = document.getElementById('resourceTypesListContainer');
    let html = '<table style="width: 100%; border-collapse: collapse; font-size: 13px;">';
    html += '<thead><tr style="background: var(--bg-secondary);">';
    html += '<th style="padding: 5px 8px; text-align: left;">Valore</th>';
    html += '<th style="padding: 5px 8px; text-align: left;">Etichetta</th>';
    html += '<th style="padding: 5px 8px; text-align: center; width: 70px;">Risorse</th>';
    html += '<th style="padding: 5px 8px; text-align: center; width: 60px;">Azioni</th>';
    html += '</tr></thead><tbody>';

    state.resourceTypes.forEach((rt, index) => {
        const count = getResourceTypeUsageCount(rt.value);
        html += `<tr style="border-bottom: 1px solid var(--border-color);">`;
        html += `<td style="padding: 5px 8px;"><input type="text" value="${escapeHtml(rt.value)}" onchange="resourcesModule.updateResourceTypeValue(${index}, this.value)" style="width: 100%; padding: 3px 6px; font-size: 12px; box-sizing: border-box;"></td>`;
        html += `<td style="padding: 5px 8px;"><input type="text" value="${escapeHtml(rt.label)}" onchange="resourcesModule.updateResourceTypeLabel(${index}, this.value)" style="width: 100%; padding: 3px 6px; font-size: 12px; box-sizing: border-box;"></td>`;
        html += `<td style="padding: 5px 8px; text-align: center; font-weight: 600;">${count}</td>`;
        html += `<td style="padding: 5px 8px; text-align: center;">`;
        if (count === 0) {
            html += `<button onclick="resourcesModule.removeResourceType(${index})" class="delete" style="padding: 2px 8px; font-size: 12px;" title="Elimina tipo">🗑️</button>`;
        } else {
            html += `<span style="color: var(--text-tertiary); font-size: 11px;" title="In uso da ${count} risorsa/e">🔒</span>`;
        }
        html += `</td></tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

/** Aggiunge un nuovo tipo risorsa dall'apposita form nel modal. */
export function addResourceType() {
    const valueInput = document.getElementById('newResourceTypeValue');
    const labelInput = document.getElementById('newResourceTypeLabel');
    let value = valueInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    let label = labelInput.value.trim();

    if (!value || !label) {
        alert('Inserisci sia il valore che l\'etichetta del tipo risorsa.');
        return;
    }
    if (state.resourceTypes.some(rt => rt.value === value)) {
        alert('Un tipo risorsa con questo valore esiste già.');
        return;
    }

    const updated = [...state.resourceTypes, { value, label }];
    state.setResourceTypes(updated);
    saveResourceTypes();
    valueInput.value = '';
    labelInput.value = '';
    renderResourceTypesList();
}

/** Aggiorna il valore (key) di un tipo risorsa e migra le risorse esistenti. */
export async function updateResourceTypeValue(index, newValue) {
    newValue = newValue.trim().toLowerCase().replace(/\s+/g, '-');
    if (!newValue) return;
    const oldValue = state.resourceTypes[index].value;
    if (newValue !== oldValue && state.resourceTypes.some(rt => rt.value === newValue)) {
        alert('Un tipo risorsa con questo valore esiste già.');
        renderResourceTypesList();
        return;
    }
    // Aggiorna le risorse che usano il vecchio valore
    for (const r of state.resources) {
        if (r.type === oldValue) {
            r.type = newValue;
            await db.save('resources', r);
        }
    }
    const updated = [...state.resourceTypes];
    updated[index] = { ...updated[index], value: newValue };
    state.setResourceTypes(updated);
    await saveResourceTypes();
    renderResourceTypesList();
    renderResources();
}

/** Aggiorna l'etichetta visibile di un tipo risorsa. */
export async function updateResourceTypeLabel(index, newLabel) {
    newLabel = newLabel.trim();
    if (!newLabel) return;
    const updated = [...state.resourceTypes];
    updated[index] = { ...updated[index], label: newLabel };
    state.setResourceTypes(updated);
    await saveResourceTypes();
    renderResourceTypesList();
    renderResources();
}

/** Rimuove un tipo risorsa (solo se non utilizzato). */
export async function removeResourceType(index) {
    const count = getResourceTypeUsageCount(state.resourceTypes[index].value);
    if (count > 0) {
        alert('Non puoi eliminare un tipo risorsa in uso.');
        return;
    }
    const updated = state.resourceTypes.filter((_, i) => i !== index);
    state.setResourceTypes(updated);
    await saveResourceTypes();
    renderResourceTypesList();
}

/** Persiste i tipi risorsa nelle settings. */
export async function saveResourceTypes() {
    await db.setSetting('resourceTypes', state.resourceTypes);
}

/** Carica i tipi risorsa dalle settings e aggiorna lo state. */
export async function loadResourceTypes() {
    const saved = await db.getSetting('resourceTypes');
    if (saved && Array.isArray(saved) && saved.length > 0) {
        state.setResourceTypes(saved);
    }
}

/** Ritorna l'etichetta leggibile di un tipo risorsa dato il suo valore. */
export function getResourceTypeLabel(type) {
    const found = state.resourceTypes.find(rt => rt.value === type);
    return type ? (found ? found.label : type) : '-';
}

// ─── Modal Risorsa ────────────────────────────────────────────────────────────

/**
 * Apre il modal risorsa.
 * @param {number|null} id  ID risorsa da modificare; null per nuova risorsa.
 */
export function openResourceModal(id = null) {
    state.setEditingResourceId(id);
    const modal = document.getElementById('resourceModal');
    const title = document.getElementById('resourceModalTitle');
    populateResourceTypeSelect();

    if (id) {
        title.textContent = 'Modifica Risorsa';
        editResource(id);
    } else {
        title.textContent = 'Nuova Risorsa';
        clearResourceForm();

        // Inizializza container assenze con una riga vuota
        const container = document.getElementById('absenceDays');
        container.innerHTML = '';
        const newRange = document.createElement('div');
        newRange.className = 'absence-range';
        newRange.innerHTML = `
            <button type="button" onclick="resourcesModule.removeAbsenceRange(this)" class="delete-absence" title="Rimuovi periodo">🗑️</button>
            <input type="date" class="absence-start">
            <span>-</span>
            <input type="date" class="absence-end">
        `;
        container.appendChild(newRange);

        const addBtn = document.createElement('button');
        addBtn.type      = 'button';
        addBtn.className = 'add-absence-btn';
        addBtn.textContent = '+ Aggiungi Periodo';
        addBtn.onclick   = addAbsenceRange;
        container.appendChild(addBtn);

        // Inizializza container permessi
        const permitContainer = document.getElementById('permitDays');
        permitContainer.innerHTML = '';
        const addPermitBtn = document.createElement('button');
        addPermitBtn.type      = 'button';
        addPermitBtn.className = 'add-permit-btn';
        addPermitBtn.textContent = '+ Aggiungi Permesso';
        addPermitBtn.onclick   = addPermitRange;
        permitContainer.appendChild(addPermitBtn);
    }

    // Inizializza calendario preview
    resCalCurrentMonth = new Date().getMonth();
    resCalCurrentYear  = new Date().getFullYear();
    setTimeout(() => {
        renderResourceCalendarPreview();
        setupCalendarAutoRefresh();
    }, 50);

    // Editor con tipi risorsa limitati: read-only se il tipo di questa risorsa non è consentito
    if (id) {
        const _ormUser = Auth.getCurrentUser();
        const _ormRes  = state.resources.find(r => r.id === id);
        if (_ormUser?.role === 'editor'
            && Array.isArray(_ormUser.allowedResourceTypes)
            && _ormUser.allowedResourceTypes.length > 0
            && _ormRes
            && !_ormUser.allowedResourceTypes.includes(_ormRes.type)) {
            modal.dataset.readOnly = 'true';
        } else {
            delete modal.dataset.readOnly;
        }
    } else {
        delete modal.dataset.readOnly;
    }

    openModal(modal);
}

/** Chiude il modal risorsa. */
export function closeResourceModal() {
    const modal = document.getElementById('resourceModal');
    if (modal) delete modal.dataset.readOnly;
    closeModal(modal);
    clearResourceForm();
}

// ─── Calendario anteprima assenze ────────────────────────────────────────────

/** Naviga il mini-calendario nel modal (direction: +1 avanti, -1 indietro). */
export function navigateResourceCalendar(direction) {
    resCalCurrentMonth += direction;
    if (resCalCurrentMonth > 11) { resCalCurrentMonth = 0; resCalCurrentYear++; }
    if (resCalCurrentMonth < 0)  { resCalCurrentMonth = 11; resCalCurrentYear--; }
    renderResourceCalendarPreview();
}

/** Legge le assenze dal form (DOM) del modal. */
function getModalAbsences() {
    const absences = [];
    document.querySelectorAll('.absence-range').forEach(range => {
        const start = range.querySelector('.absence-start')?.value;
        const end   = range.querySelector('.absence-end')?.value || start;
        const type  = range.querySelector('.absence-type')?.value || 'vacation';
        if (start) absences.push({ start, end, type });
    });
    return absences;
}

/** Legge i permessi dal form (DOM) del modal. */
function getModalPermits() {
    const permits = [];
    document.querySelectorAll('.permit-range').forEach(range => {
        const date      = range.querySelector('.permit-date')?.value;
        const startTime = range.querySelector('.permit-start-time')?.value;
        const endTime   = range.querySelector('.permit-end-time')?.value;
        if (date && startTime && endTime) permits.push({ date, startTime, endTime });
    });
    return permits;
}

/** Renderizza il mini-calendario assenze/permessi nel modal. */
export function renderResourceCalendarPreview() {
    const grid  = document.getElementById('resCalGrid');
    const label = document.getElementById('resCalMonthLabel');
    if (!grid || !label) return;

    const monthNames = [
        'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
        'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'
    ];
    label.textContent = `${monthNames[resCalCurrentMonth]} ${resCalCurrentYear}`;

    const absences = getModalAbsences();
    const permits  = getModalPermits();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    grid.innerHTML = '';

    // Header giorni settimana
    ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].forEach(d => {
        const h = document.createElement('div');
        h.className   = 'res-cal-header';
        h.textContent = d;
        grid.appendChild(h);
    });

    const firstDay    = new Date(resCalCurrentYear, resCalCurrentMonth, 1);
    const lastDay     = new Date(resCalCurrentYear, resCalCurrentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Celle vuote prima del primo giorno (Lun=0 … Dom=6)
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;
    for (let i = 0; i < startDow; i++) {
        const empty = document.createElement('div');
        empty.className = 'res-cal-day empty';
        grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cell    = document.createElement('div');
        cell.className = 'res-cal-day';
        const dateObj = new Date(resCalCurrentYear, resCalCurrentMonth, day);
        dateObj.setHours(0, 0, 0, 0);
        const dateStr = formatDateLocal(dateObj);
        const dow     = dateObj.getDay();

        if (dow === 0 || dow === 6)           cell.classList.add('weekend');
        if (dateObj.getTime() === today.getTime()) cell.classList.add('today');

        // Tipo assenza per questo giorno
        let absType = null;
        absences.forEach(abs => {
            const s = new Date(abs.start); s.setHours(0, 0, 0, 0);
            const e = new Date(abs.end || abs.start); e.setHours(23, 59, 59, 999);
            if (dateObj >= s && dateObj <= e) absType = abs.type || 'vacation';
        });

        // Permesso per questo giorno
        let permitMatch = null;
        permits.forEach(p => {
            if (p.date === dateStr) permitMatch = p;
        });

        if (absType) {
            if (absType === 'sick')               cell.classList.add('absence-sick');
            else if (absType === 'planned_intervention') cell.classList.add('absence-planned');
            else                                  cell.classList.add('absence-vacation');
        } else if (permitMatch) {
            cell.classList.add('permit');
        }

        cell.textContent = day;

        if (permitMatch) {
            const timeSpan = document.createElement('span');
            timeSpan.className   = 'res-cal-permit-time';
            timeSpan.textContent = `${permitMatch.startTime}-${permitMatch.endTime}`;
            cell.appendChild(timeSpan);
        }

        // Tooltip
        let title = dateStr;
        if (absType === 'vacation')            title += ' — 🏖️ Ferie';
        else if (absType === 'sick')           title += ' — 🤒 Malattia';
        else if (absType === 'planned_intervention') title += ' — 🏥 Intervento Pianificato';
        if (permitMatch) title += ` — ⏰ Permesso ${permitMatch.startTime}-${permitMatch.endTime}`;
        cell.title = title;

        grid.appendChild(cell);
    }
}

/** Configura MutationObserver per aggiornare il calendario al cambio delle assenze. */
export function setupCalendarAutoRefresh() {
    const absContainer    = document.getElementById('absenceDays');
    const permitContainer = document.getElementById('permitDays');
    if (absContainer) {
        const observer = new MutationObserver(() => renderResourceCalendarPreview());
        observer.observe(absContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
        absContainer.addEventListener('change', renderResourceCalendarPreview);
    }
    if (permitContainer) {
        const observer = new MutationObserver(() => renderResourceCalendarPreview());
        observer.observe(permitContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
        permitContainer.addEventListener('change', renderResourceCalendarPreview);
    }
}

// ─── Gestione periodi assenza e permessi (DOM) ────────────────────────────────

/** Aggiunge una riga periodo assenza nel form del modal. */
export function addAbsenceRange() {
    const container = document.getElementById('absenceDays');

    const existingAddBtn = container.querySelector('.add-absence-btn');
    if (existingAddBtn) existingAddBtn.remove();

    const newRange = document.createElement('div');
    newRange.className = 'absence-range';
    newRange.innerHTML = `
        <button type="button" onclick="resourcesModule.removeAbsenceRange(this)" class="delete-absence" title="Rimuovi periodo">🗑️</button>
        <select class="absence-type">
            <option value="vacation">Ferie</option>
            <option value="sick">Malattia</option>
            <option value="planned_intervention">Intervento Pianificato</option>
        </select>
        <input type="date" class="absence-start">
        <span>-</span>
        <input type="date" class="absence-end">
    `;
    container.appendChild(newRange);

    // Copia data inizio in data fine se ancora vuota
    const startInput = newRange.querySelector('.absence-start');
    const endInput   = newRange.querySelector('.absence-end');
    startInput.addEventListener('change', function () {
        if (this.value && !endInput.value) endInput.value = this.value;
    });

    const addBtn = document.createElement('button');
    addBtn.type      = 'button';
    addBtn.className = 'add-absence-btn';
    addBtn.textContent = '+ Aggiungi Periodo';
    addBtn.onclick   = addAbsenceRange;
    container.appendChild(addBtn);
}

/** Rimuove la riga assenza corrispondente al pulsante premuto. */
export function removeAbsenceRange(button) {
    button.parentElement.remove();
}

/** Aggiunge una riga permesso nel form del modal. */
export function addPermitRange() {
    const container = document.getElementById('permitDays');

    const existingAddBtn = container.querySelector('.add-permit-btn');
    if (existingAddBtn) existingAddBtn.remove();

    const newRange = document.createElement('div');
    newRange.className = 'permit-range';
    newRange.innerHTML = `
        <button type="button" onclick="resourcesModule.removePermitRange(this)" class="delete-permit" title="Rimuovi permesso">🗑️</button>
        <input type="date" class="permit-date">
        <span>dalle</span>
        <input type="time" class="permit-start-time" value="09:00">
        <span>alle</span>
        <input type="time" class="permit-end-time" value="13:00">
    `;
    container.appendChild(newRange);

    const addBtn = document.createElement('button');
    addBtn.type      = 'button';
    addBtn.className = 'add-permit-btn';
    addBtn.textContent = '+ Aggiungi Permesso';
    addBtn.onclick   = addPermitRange;
    container.appendChild(addBtn);
}

/** Rimuove la riga permesso corrispondente al pulsante premuto. */
export function removePermitRange(button) {
    button.parentElement.remove();
}

// ─── Analisi impatto assenze ──────────────────────────────────────────────────

/**
 * Trova le attività con ritardi causati da assenze delle risorse assegnate.
 * Richiede che calculateEndDateForTask sia disponibile globalmente o importata.
 * @returns {{ project, task, delayDays, affectedResources }[]}
 */
export function findTasksWithAbsenceDelays() {
    // TODO: importare calculateEndDateForTask da helpers.js quando disponibile
    if (typeof calculateEndDateForTask === 'undefined') return [];

    const tasksWithDelays = [];
    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (task.status === 'completata') return;
            if (!task.resources || task.resources.length === 0) return;
            if (!task.startDate || !task.duration) return;

            const endWithout = calculateEndDateForTask(
                task.startDate, task.duration,
                task.saturdayWork, task.sundayWork, task.holidayWork, []
            );
            const endWith = calculateEndDateForTask(
                task.startDate, task.duration,
                task.saturdayWork, task.sundayWork, task.holidayWork, task.resources
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
                            const r = state.resources.find(r => r.id == tr.resourceId);
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
 * Controlla se le nuove assenze di una risorsa si sovrappongono ad attività attive.
 * @param {number}   resourceId   ID risorsa
 * @param {{ start: string, end?: string }[]} newAbsences
 * @returns {{ project, task, absenceStart, absenceEnd }[]}
 */
export function checkAbsenceProjectOverlap(resourceId, newAbsences) {
    const overlaps = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (!task.resources || !task.startDate || !task.endDate) return;
            if (!task.resources.some(tr => tr.resourceId == resourceId)) return;
            if (task.completion === 100 || task.status === 'completata' || task.status === 'annullata') return;

            const taskEndDate = new Date(task.endDate);
            taskEndDate.setHours(0, 0, 0, 0);
            if (taskEndDate < today) return;

            newAbsences.forEach(absence => {
                const absenceStart = new Date(absence.start);
                const absenceEnd   = new Date(absence.end || absence.start);
                const taskStart    = new Date(task.startDate);
                const taskEnd      = new Date(task.endDate);
                [absenceStart, absenceEnd, taskStart, taskEnd].forEach(d => d.setHours(0, 0, 0, 0));

                if (absenceStart <= taskEnd && absenceEnd >= taskStart) {
                    overlaps.push({
                        project,
                        task,
                        absenceStart: absence.start,
                        absenceEnd:   absence.end || absence.start
                    });
                }
            });
        });
    });
    return overlaps;
}

// ─── CRUD Risorse ─────────────────────────────────────────────────────────────

/** Salva (crea o aggiorna) la risorsa dal form del modal. */
export async function saveResource() {
    const firstName = document.getElementById('resourceFirstName').value.trim();
    const lastName  = document.getElementById('resourceLastName').value.trim();

    if (!firstName || !lastName) {
        alert('Nome e Cognome sono obbligatori');
        return;
    }

    const absences = [];
    document.querySelectorAll('.absence-range').forEach(range => {
        const start = range.querySelector('.absence-start').value;
        const end   = range.querySelector('.absence-end').value || start;
        const type  = range.querySelector('.absence-type')?.value || 'vacation';
        if (start) absences.push({ start, end, type });
    });

    const permits = [];
    document.querySelectorAll('.permit-range').forEach(range => {
        const date      = range.querySelector('.permit-date').value;
        const startTime = range.querySelector('.permit-start-time').value;
        const endTime   = range.querySelector('.permit-end-time').value;
        if (date && startTime && endTime) permits.push({ date, startTime, endTime });
    });

    const editingId = state.editingResourceId;
    const resource  = {
        id:        editingId || generateId(),
        firstName,
        lastName,
        type:      document.getElementById('resourceType').value || '',
        absences,
        permits,
        order:     editingId
            ? (state.resources.find(r => r.id === editingId)?.order ?? 0)
            : state.resources.length
    };

    // Verifica sovrapposizioni con attività attive
    if (absences.length > 0 && resource.id) {
        const overlaps = checkAbsenceProjectOverlap(resource.id, absences);
        if (overlaps.length > 0) {
            let message = `⚠️ ATTENZIONE: Questa risorsa ha ${overlaps.length} attività in corso durante il periodo di assenza:\n\n`;
            overlaps.forEach((overlap, index) => {
                if (index < 5) {
                    message += `• ${overlap.project.code} - ${overlap.task.name} (${overlap.task.startDate} - ${overlap.task.endDate})\n`;
                }
            });
            if (overlaps.length > 5) message += `\n... e altre ${overlaps.length - 5} attività`;
            message += '\nLe date delle attività verranno automaticamente ricalcolate.\n\nVuoi procedere comunque?';
            if (!confirm(message)) return;
        }
    }

    // Aggiorna state
    if (editingId) {
        const idx = state.resources.findIndex(r => r.id === editingId);
        state.resources[idx] = resource;
    } else {
        state.resources.push(resource);
    }

    // Persisti su DB
    await db.save('resources', resource);

    // Ricalcola date fine attività collegate (richiede calculateEndDateForTask)
    // TODO: sostituire il riferimento globale con import da helpers.js
    if (typeof calculateEndDateForTask === 'function') {
        for (const project of state.projects) {
            if (!project.tasks) continue;
            for (const task of project.tasks) {
                if (!task.resources || !task.resources.some(tr => tr.resourceId == resource.id)) continue;
                if (!task.startLinkedTo && !task.endLinkedTo && task.startDate && task.duration) {
                    task.endDate = calculateEndDateForTask(
                        task.startDate, task.duration,
                        task.saturdayWork, task.sundayWork, task.holidayWork,
                        task.resources
                    );
                    await db.save('projects', project);
                }
            }
        }
    }

    renderResources();
    updateResourceSelects();
    closeResourceModal();
    _triggerViewRefresh(['tasks', 'gantt', 'warnings']);
}

/** Carica i dati di una risorsa esistente nel form del modal. */
export function editResource(id) {
    const resource = state.resources.find(r => r.id === id);
    if (!resource) return;

    state.setEditingResourceId(id);
    document.getElementById('resourceFirstName').value = resource.firstName;
    document.getElementById('resourceLastName').value  = resource.lastName;
    document.getElementById('resourceType').value      = resource.type || '';

    // Assenze
    const container = document.getElementById('absenceDays');
    container.innerHTML = '';

    if (resource.absences && resource.absences.length > 0) {
        resource.absences.forEach(absence => {
            const absenceType = absence.type || 'vacation';
            const newRange = document.createElement('div');
            newRange.className = 'absence-range';
            newRange.innerHTML = `
                <button type="button" onclick="resourcesModule.removeAbsenceRange(this)" class="delete-absence" title="Rimuovi periodo">🗑️</button>
                <select class="absence-type">
                    <option value="vacation" ${absenceType === 'vacation' ? 'selected' : ''}>Ferie</option>
                    <option value="sick" ${absenceType === 'sick' ? 'selected' : ''}>Malattia</option>
                    <option value="planned_intervention" ${absenceType === 'planned_intervention' ? 'selected' : ''}>Intervento Pianificato</option>
                </select>
                <input type="date" class="absence-start" value="${absence.start}">
                <span>-</span>
                <input type="date" class="absence-end" value="${absence.end}">
            `;
            container.appendChild(newRange);
        });
    } else {
        const newRange = document.createElement('div');
        newRange.className = 'absence-range';
        newRange.innerHTML = `
            <button type="button" onclick="resourcesModule.removeAbsenceRange(this)" class="delete-absence" title="Rimuovi periodo">🗑️</button>
            <select class="absence-type">
                <option value="vacation">Ferie</option>
                <option value="sick">Malattia</option>
                <option value="planned_intervention">Intervento Pianificato</option>
            </select>
            <input type="date" class="absence-start">
            <span>-</span>
            <input type="date" class="absence-end">
        `;
        container.appendChild(newRange);
    }

    const addAbsBtn = document.createElement('button');
    addAbsBtn.type      = 'button';
    addAbsBtn.className = 'add-absence-btn';
    addAbsBtn.textContent = '+ Aggiungi Periodo';
    addAbsBtn.onclick   = addAbsenceRange;
    container.appendChild(addAbsBtn);

    // Permessi
    const permitContainer = document.getElementById('permitDays');
    permitContainer.innerHTML = '';

    if (resource.permits && resource.permits.length > 0) {
        resource.permits.forEach(permit => {
            const newRange = document.createElement('div');
            newRange.className = 'permit-range';
            newRange.innerHTML = `
                <button type="button" onclick="resourcesModule.removePermitRange(this)" class="delete-permit" title="Rimuovi permesso">🗑️</button>
                <input type="date" class="permit-date" value="${permit.date}">
                <span>dalle</span>
                <input type="time" class="permit-start-time" value="${permit.startTime}">
                <span>alle</span>
                <input type="time" class="permit-end-time" value="${permit.endTime}">
            `;
            permitContainer.appendChild(newRange);
        });
    }

    const addPermitBtn = document.createElement('button');
    addPermitBtn.type      = 'button';
    addPermitBtn.className = 'add-permit-btn';
    addPermitBtn.textContent = '+ Aggiungi Permesso';
    addPermitBtn.onclick   = addPermitRange;
    permitContainer.appendChild(addPermitBtn);

    // Aggiorna calendario preview
    resCalCurrentMonth = new Date().getMonth();
    resCalCurrentYear  = new Date().getFullYear();
    setTimeout(() => {
        renderResourceCalendarPreview();
        setupCalendarAutoRefresh();
    }, 50);
}

/** Elimina una risorsa previa conferma. */
export async function deleteResource(id) {
    if (!confirm('Sei sicuro di voler eliminare questa risorsa?')) return;
    state.setResources(state.resources.filter(r => r.id !== id));
    await db.remove('resources', id);
    renderResources();
    updateResourceSelects();
    _triggerViewRefresh(['tasks', 'gantt', 'resourceView', 'warnings']);
}

/** Resetta il form del modal risorsa allo stato vuoto. */
export function clearResourceForm() {
    state.setEditingResourceId(null);
    document.getElementById('resourceFirstName').value = '';
    document.getElementById('resourceLastName').value  = '';
    document.getElementById('resourceType').value      = '';

    const container = document.getElementById('absenceDays');
    container.innerHTML = `
        <div class="absence-range">
            <button type="button" onclick="resourcesModule.removeAbsenceRange(this)" class="delete-absence" title="Rimuovi periodo">🗑️</button>
            <select class="absence-type">
                <option value="vacation">Ferie</option>
                <option value="sick">Malattia</option>
                <option value="planned_intervention">Intervento Pianificato</option>
            </select>
            <input type="date" class="absence-start">
            <span>-</span>
            <input type="date" class="absence-end">
        </div>
        <button type="button" class="add-absence-btn" onclick="resourcesModule.addAbsenceRange()">+ Aggiungi Periodo</button>
    `;
    const permitContainer = document.getElementById('permitDays');
    permitContainer.innerHTML = `
        <button type="button" class="add-permit-btn" onclick="resourcesModule.addPermitRange()">+ Aggiungi Permesso</button>
    `;
}

// ─── Rendering lista risorse ──────────────────────────────────────────────────

/** Renderizza la tabella delle risorse con filtri. */
export function renderResources() {
    const tbody = document.querySelector('#resourcesTable tbody');
    tbody.innerHTML = '';

    const filterFirstName = (document.getElementById('resourceFilterFirstName')?.value || '').toLowerCase();
    const filterLastName  = (document.getElementById('resourceFilterLastName')?.value  || '').toLowerCase();
    const filterType      = (document.getElementById('resourceFilterType')?.value      || '').toLowerCase();

    const typeLabels = {};
    state.resourceTypes.forEach(rt => { typeLabels[rt.value] = rt.label; });

    state.resources.forEach((resource, index) => {
        const typeLabel = resource.type ? typeLabels[resource.type] || resource.type : '-';

        if (filterFirstName && !(resource.firstName || '').toLowerCase().includes(filterFirstName)) return;
        if (filterLastName  && !(resource.lastName  || '').toLowerCase().includes(filterLastName))  return;
        if (filterType      && !typeLabel.toLowerCase().includes(filterType))                        return;

        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', e => {
            if (e.target.closest('button')) return;
            openResourceModal(resource.id);
        });

        const absencesStr = (resource.absences || []).map(a => {
            const tl = a.type === 'sick' ? '🤒 Malattia'
                     : a.type === 'planned_intervention' ? '🏥 Intervento Pianificato'
                     : '🏖️ Ferie';
            const dateStr = a.start === a.end ? a.start : `${a.start} - ${a.end}`;
            return `${tl}: ${dateStr}`;
        }).join(', ') || 'Nessuna';

        const permitsStr = (resource.permits || []).map(p =>
            `⏰ Permesso: ${p.date} ${p.startTime}-${p.endTime}`
        ).join(', ');

        const allAbsencesStr = [
            absencesStr !== 'Nessuna' ? absencesStr : '',
            permitsStr
        ].filter(Boolean).join(', ') || 'Nessuna';

        const isHidden = resource.hidden || false;

        // Determina se l'utente può gestire questa risorsa
        const _resUser = Auth.getCurrentUser();
        const _canManage = !_resUser
            || _resUser.role === 'admin'
            || (_resUser.role === 'editor' && (
                !Array.isArray(_resUser.allowedResourceTypes)
                || _resUser.allowedResourceTypes.length === 0
                || _resUser.allowedResourceTypes.includes(resource.type)
            ));
        const _hideActions = _canManage ? '' : 'style="display:none"';

        tr.innerHTML = `
            <td style="width: 80px;">
                <button onclick="resourcesModule.moveResourceUp(${index})" ${index === 0 ? 'disabled' : ''} style="padding: 2px 6px; font-size: 12px; margin-right: 2px;" title="Sposta su">⬆️</button>
                <button onclick="resourcesModule.moveResourceDown(${index})" ${index === state.resources.length - 1 ? 'disabled' : ''} style="padding: 2px 6px; font-size: 12px;" title="Sposta giù">⬇️</button>
            </td>
            <td>${resource.firstName}</td>
            <td>${resource.lastName}</td>
            <td>${typeLabel}</td>
            <td style="font-size: 11px;">${allAbsencesStr}</td>
            <td style="text-align: center;">
                <button onclick="resourcesModule.toggleResourceVisibility(${resource.id})" ${_canManage ? '' : 'disabled'} style="padding: 4px 8px; font-size: 18px; cursor: pointer; ${isHidden ? 'opacity: 0.3;' : ''}" title="${isHidden ? 'Mostra in Gantt e Vista Risorse' : 'Nascondi da Gantt e Vista Risorse'}">${isHidden ? '○' : '●'}</button>
            </td>
            <td class="action-buttons">
                <button onclick="resourcesModule.exportResourceMarkdown(${resource.id})" class="secondary" title="Esporta riepilogo attività in Markdown">📄 Esporta MD</button>
                <button onclick="resourcesModule.openResourceModal(${resource.id})" class="secondary">✏️ Modifica</button>
                <button onclick="resourcesModule.deleteResource(${resource.id})" class="delete" ${_hideActions}>🗑️ Elimina</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ─── Riordino risorse ─────────────────────────────────────────────────────────

/** Sposta la risorsa all'indice `index` una posizione in su. */
export async function moveResourceUp(index) {
    if (index <= 0) return;
    const arr = [...state.resources];
    [arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
    arr.forEach((r, i) => { r.order = i; });
    state.setResources(arr);
    // Salva le due risorse modificate
    await db.save('resources', arr[index - 1]);
    await db.save('resources', arr[index]);
    renderResources();
    _triggerViewRefresh(['gantt', 'resourceView']);
}

/** Sposta la risorsa all'indice `index` una posizione in giù. */
export async function moveResourceDown(index) {
    if (index >= state.resources.length - 1) return;
    const arr = [...state.resources];
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    arr.forEach((r, i) => { r.order = i; });
    state.setResources(arr);
    await db.save('resources', arr[index]);
    await db.save('resources', arr[index + 1]);
    renderResources();
    _triggerViewRefresh(['gantt', 'resourceView']);
}

/** Alterna la visibilità di una risorsa nel Gantt e nella Vista Risorse. */
export async function toggleResourceVisibility(resourceId) {
    const resource = state.resources.find(r => r.id === resourceId);
    if (!resource) return;
    resource.hidden = !resource.hidden;
    await db.save('resources', resource);
    renderResources();
    _triggerViewRefresh(['gantt', 'resourceView']);
}

// ─── Selects risorse (in form attività) ──────────────────────────────────────

/**
 * Aggiorna tutte le <select class="task-resource-select"> con le risorse correnti.
 * Chiamata dopo ogni modifica all'elenco risorse.
 */
export function updateResourceSelects() {
    const selects = document.querySelectorAll('.task-resource-select');
    selects.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '<option value="">-- Seleziona Risorsa --</option>';
        state.resources.forEach(r => {
            const option = document.createElement('option');
            option.value       = r.id;
            option.textContent = `${r.firstName} ${r.lastName}`;
            if (r.id == currentValue) option.selected = true;
            select.appendChild(option);
        });
    });
}

// ─── Export Markdown risorsa ──────────────────────────────────────────────────

/** Esporta il riepilogo attività di una risorsa in formato Markdown (.md). */
export function exportResourceMarkdown(resourceId) {
    const resource = state.resources.find(r => r.id === resourceId);
    if (!resource) {
        alert('Risorsa non trovata');
        return;
    }

    const resourceName = `${resource.firstName} ${resource.lastName}`;

    // Raccoglie le attività attive assegnate alla risorsa, raggruppate per progetto
    const tasksByProject = new Map();
    state.projects.forEach(project => {
        if (!project.tasks) return;
        const assignedTasks = project.tasks.filter(task => {
            if (task.status === 'completata' || task.status === 'annullata' || task.completion >= 100) return false;
            return task.resources && task.resources.some(r => r.resourceId == resourceId);
        });
        if (assignedTasks.length > 0) tasksByProject.set(project, assignedTasks);
    });

    if (tasksByProject.size === 0) {
        alert('Nessuna attività non completata assegnata a questa risorsa');
        return;
    }

    let md = `# Riepilogo Attività - ${resourceName}\n\n`;
    md += `**Tipo:** ${getResourceTypeLabel(resource.type)}\n\n`;
    md += `**Generato il:** ${new Date().toLocaleString('it-IT')}\n\n`;
    md += `---\n\n`;

    let totalTasks = 0;
    tasksByProject.forEach(tasks => { totalTasks += tasks.length; });

    md += `## 📊 Statistiche\n\n`;
    md += `| Metrica | Valore |\n`;
    md += `|---------|--------|\n`;
    md += `| **Progetti Attivi** | ${tasksByProject.size} |\n`;
    md += `| **Attività Totali** | ${totalTasks} |\n\n`;

    if (resource.absences && resource.absences.length > 0) {
        md += `## 🏖️ Assenze Pianificate\n\n`;
        resource.absences.forEach(absence => {
            const typeLabel = absence.type === 'sick' ? '🤒 Malattia'
                            : absence.type === 'planned_intervention' ? '🏥 Intervento Pianificato'
                            : '🏖️ Ferie';
            const dateStr = absence.start === absence.end ? absence.start : `${absence.start} - ${absence.end}`;
            md += `- ${typeLabel}: ${dateStr}\n`;
        });
        md += `\n`;
    }

    if (resource.permits && resource.permits.length > 0) {
        md += `## ⏰ Permessi\n\n`;
        resource.permits.forEach(permit => {
            md += `- ${permit.date}: ${permit.startTime} - ${permit.endTime}\n`;
        });
        md += `\n`;
    }

    // Ordina progetti per data di inizio più vicina
    const sortedProjects = Array.from(tasksByProject.entries()).sort((a, b) => {
        const getEarliest = tasks => {
            const dates = tasks.map(t => t.startDate).filter(Boolean);
            return dates.length === 0 ? '9999-99-99' : dates.sort()[0];
        };
        return getEarliest(a[1]).localeCompare(getEarliest(b[1]));
    });

    // Calcola date globali per sincronizzare i Gantt
    let globalMinDate = null;
    let globalMaxDate = null;
    sortedProjects.forEach(([, tasks]) => {
        tasks.forEach(task => {
            if (task.startDate && task.endDate) {
                const start = new Date(task.startDate);
                const end   = new Date(task.endDate);
                if (!globalMinDate || start < globalMinDate) globalMinDate = start;
                if (!globalMaxDate || end   > globalMaxDate) globalMaxDate = end;
            }
        });
    });

    md += `## 📅 Timeline Progetti\n\n`;
    md += _generateOverviewGanttForResource(sortedProjects, resource, globalMinDate, globalMaxDate);
    md += `\n`;

    md += `## 📋 Attività per Progetto\n\n`;
    sortedProjects.forEach(([project, tasks]) => {
        md += `### ${project.client || 'Cliente N/A'} - ${project.code || 'N/A'}\n\n`;
        if (project.description) md += `*${project.description}*\n\n`;

        const sortedTasks = [...tasks].sort((a, b) => {
            if (!a.startDate) return 1;
            if (!b.startDate) return -1;
            return new Date(a.startDate) - new Date(b.startDate);
        });

        const statusLabels = {
            'in-corso':   '🔄 In Corso',
            'in-ritardo': '⚠️ In Ritardo',
            'pausa':      '⏸️ Pausa',
            'completata': '✅ Completata',
            'annullata':  '❌ Annullata'
        };

        md += `| Attività | Date | Durata | Completamento | Stato | Allocazione |\n`;
        md += `|----------|------|--------|---------------|-------|-------------|\n`;

        sortedTasks.forEach(task => {
            const statusIcon  = statusLabels[task.status] || '-';
            const dateRange   = `${task.startDate || '-'} → ${task.endDate || '-'}`;
            const resourceAlloc = task.resources.find(r => r.resourceId == resourceId);
            const allocation  = resourceAlloc ? `${resourceAlloc.percentage}%` : '-';
            const today       = formatDateLocal(new Date());
            const isOverdue   = task.endDate && task.endDate < today;
            const taskName    = isOverdue ? `**${task.name}** 🔴` : task.name;

            md += `| ${taskName} | ${dateRange} | ${task.duration} gg | ${task.completion}% | ${statusIcon} | ${allocation} |\n`;
        });

        md += `\n`;
        md += _generateGanttForResourceProject(project, tasks, resource, globalMinDate, globalMaxDate);
        md += `\n`;
    });

    md += `---\n\n`;
    md += `*Report generato automaticamente da Project Planner il ${new Date().toLocaleString('it-IT')}*\n`;

    // Download
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = `${resource.firstName}_${resource.lastName}_${formatDateLocal(new Date())}.md`
                      .replace(/[^a-z0-9._-]/gi, '_');
    link.click();
    URL.revokeObjectURL(url);
}

// ─── Generatori Gantt Mermaid (interni al modulo) ─────────────────────────────

function _generateGanttForResourceProject(project, tasks, resource, globalMinDate, globalMaxDate) {
    let gantt = `#### Diagramma Gantt - ${project.code || 'Progetto'}\n\n`;
    gantt += '```mermaid\n';
    gantt += 'gantt\n';
    gantt += `    title ${project.code || 'Progetto'} - ${resource.firstName} ${resource.lastName}\n`;
    gantt += '    dateFormat YYYY-MM-DD\n';
    gantt += '    axisFormat %d/%m\n';
    gantt += '    tickInterval 1week\n\n';

    if (globalMinDate && globalMaxDate) {
        const minDate = globalMinDate.toISOString().split('T')[0];
        const maxDate = globalMaxDate.toISOString().split('T')[0];
        gantt += `    section Periodo\n`;
        gantt += `    . :done, ${minDate}, ${maxDate}\n\n`;
    }

    gantt += '    section Attività\n';
    const sortedTasks = [...tasks].sort((a, b) => {
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return new Date(a.startDate) - new Date(b.startDate);
    });

    sortedTasks.forEach(task => {
        if (!task.startDate || !task.endDate) return;
        const safeName = task.name.replace(/:/g, ' -').replace(/,/g, '').substring(0, 50);
        let taskState = 'active';
        if (task.status === 'completata' || task.completion >= 100) taskState = 'done';
        else if (task.status === 'annullata' || task.status === 'in-ritardo') taskState = 'crit';

        let endDate = task.endDate;
        if (task.startDate === task.endDate) {
            const end = new Date(task.endDate);
            end.setDate(end.getDate() + 1);
            endDate = end.toISOString().split('T')[0];
        }
        gantt += `    ${safeName} :${taskState}, ${task.startDate}, ${endDate}\n`;
    });

    gantt += '```\n\n';
    return gantt;
}

function _generateOverviewGanttForResource(sortedProjects, resource, globalMinDate, globalMaxDate) {
    let gantt = `#### Diagramma Gantt - Overview Progetti\n\n`;
    gantt += '```mermaid\n';
    gantt += 'gantt\n';
    gantt += `    title Overview Progetti - ${resource.firstName} ${resource.lastName}\n`;
    gantt += '    dateFormat YYYY-MM-DD\n';
    gantt += '    axisFormat %d/%m\n';
    gantt += '    tickInterval 1week\n\n';

    if (globalMinDate && globalMaxDate) {
        const minDate = globalMinDate.toISOString().split('T')[0];
        const maxDate = globalMaxDate.toISOString().split('T')[0];
        gantt += `    section Periodo\n`;
        gantt += `    . :done, ${minDate}, ${maxDate}\n\n`;
    }

    sortedProjects.forEach(([project, tasks]) => {
        if (project.status === 'completato' || project.status === 'annullato') return;
        const validTasks = tasks.filter(t => t.startDate && t.endDate);
        if (validTasks.length === 0) return;

        const projectName = `${project.client || 'Cliente'} - ${project.code || 'N/A'}`;
        const safeName    = projectName.replace(/:/g, ' -').replace(/,/g, '').substring(0, 60);
        gantt += `    section ${safeName}\n`;

        const sortedTasks = [...validTasks].sort(
            (a, b) => new Date(a.startDate) - new Date(b.startDate)
        );

        sortedTasks.forEach(task => {
            const resourceAlloc = task.resources.find(r => r.resourceId == resource.id);
            const allocation    = resourceAlloc ? `${resourceAlloc.percentage}%` : '-%';
            let taskState = 'active';
            if (task.status === 'completata' || task.completion >= 100) taskState = 'done';
            else if (task.status === 'annullata' || task.status === 'in-ritardo') taskState = 'crit';

            let endDate = task.endDate;
            if (task.startDate === task.endDate) {
                const end = new Date(task.endDate);
                end.setDate(end.getDate() + 1);
                endDate = end.toISOString().split('T')[0];
            }
            gantt += `    ${allocation} :${taskState}, ${task.startDate}, ${endDate}\n`;
        });
    });

    gantt += '```\n\n';
    return gantt;
}


