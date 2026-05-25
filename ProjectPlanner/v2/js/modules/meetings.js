/**
 * js/modules/meetings.js
 *
 * Gestione riunioni: riunioni di progetto (embedded in projects) e
 * riunioni globali aziendali (store 'meetings' in IndexedDB).
 *
 * Dipendenze v2:
 *   - ../db.js       → db.save, db.remove
 *   - ../state.js    → state.meetings, state.setMeetings, state.projects,
 *                       state.resources, state.currentProjectId
 *   - ../helpers.js  → openModal, closeModal, escapeHtml, formatDateLocal,
 *                       getResourceName, parseDurationToMinutes
 */

import * as db    from '../db.js';
import * as state from '../state.js';
import {
    openModal, closeModal,
    escapeHtml, formatDateLocal,
    getResourceName, parseDurationToMinutes
} from '../helpers.js';

// ─── Stato locale ──────────────────────────────────────────────────────────────
let _editingProjectMeetingId = null;  // indice nella vista ordinata
let _editingGlobalMeetingId  = null;  // id stringa riunione globale

// ─── Utilità ───────────────────────────────────────────────────────────────────

/** Popola un <select> con orari ogni 5 minuti (00:00–23:55). */
export function populateTimeSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '<option value="">--</option>';
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 5) {
            const val = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        }
    }
    if (currentValue) select.value = currentValue;
}

/** Aggiorna il datalist con i tag usati nelle riunioni globali. */
export function updateMeetingTagsSuggestions() {
    const datalist = document.getElementById('meetingTagsSuggestions');
    if (!datalist) return;
    const tagsSet = new Set();
    state.meetings.forEach(meeting => {
        if (meeting.tags) {
            meeting.tags.split(',').forEach(tag => tagsSet.add(tag.trim()));
        }
    });
    datalist.innerHTML = '';
    tagsSet.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        datalist.appendChild(option);
    });
}

// ─── Riunioni di Progetto ──────────────────────────────────────────────────────

/** Renderizza la tabella delle riunioni del progetto corrente. */
export function renderProjectMeetings() {
    const project = state.projects.find(p => p.id === state.currentProjectId);
    if (!project) return;

    const tbody = document.querySelector('#projectMeetingsTable tbody');
    tbody.innerHTML = '';

    const meetings = [...(project.meetings || [])].sort((a, b) => new Date(b.date) - new Date(a.date));

    meetings.forEach((meeting, index) => {
        const row = tbody.insertRow();
        const date = new Date(meeting.date);

        row.style.cursor = 'pointer';
        row.onclick = function (e) {
            if (e.target.tagName !== 'BUTTON') openProjectMeetingModal(index, true);
        };

        row.innerHTML = `
            <td>${date.toLocaleDateString('it-IT')}</td>
            <td>${escapeHtml(meeting.subject)}</td>
            <td>${escapeHtml(meeting.participants)}</td>
            <td>
                <button onclick="event.stopPropagation(); openProjectMeetingModal(${index})" title="Modifica" style="padding: 4px 8px; font-size: 12px;">✏️</button>
                <button onclick="event.stopPropagation(); deleteProjectMeeting(${index})" title="Elimina" style="padding: 4px 8px; font-size: 12px;">🗑️</button>
            </td>
        `;
    });

    if (meetings.length === 0) {
        const row = tbody.insertRow();
        row.innerHTML = '<td colspan="4" style="text-align: center; color: var(--text-tertiary); font-style: italic;">Nessuna riunione presente</td>';
    }
}

/** Apre il modal per creare o modificare una riunione di progetto. */
export function openProjectMeetingModal(id = null, viewOnly = false) {
    _editingProjectMeetingId = id;
    const modal = document.getElementById('meetingModal');
    modal.style.display = 'block';
    document.body.classList.add('modal-open');

    const isViewOnly = viewOnly === true;
    ['meetingDate', 'meetingSubject', 'meetingParticipants', 'meetingTopics'].forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if (el) el.disabled = isViewOnly;
    });

    const saveBtn = document.querySelector('#meetingModal .modal-footer button:last-child');
    if (saveBtn) saveBtn.style.display = isViewOnly ? 'none' : 'inline-block';

    if (id !== null) {
        const project  = state.projects.find(p => p.id === state.currentProjectId);
        const sorted   = [...(project.meetings || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
        const meeting  = sorted[id];

        document.getElementById('meetingModalTitle').textContent = isViewOnly ? '👥 Visualizza Riunione' : '👥 Modifica Riunione';
        document.getElementById('meetingDate').value         = meeting.date;
        document.getElementById('meetingSubject').value      = meeting.subject;
        document.getElementById('meetingParticipants').value = meeting.participants;
        document.getElementById('meetingTopics').value       = meeting.topics || '';
    } else {
        document.getElementById('meetingModalTitle').textContent = '👥 Nuova Riunione';
        document.getElementById('meetingDate').value         = formatDateLocal(new Date());
        document.getElementById('meetingSubject').value      = '';
        document.getElementById('meetingParticipants').value = '';
        document.getElementById('meetingTopics').value       = '';
    }
}

/** Chiude il modal riunione di progetto. */
export function closeProjectMeetingModal() {
    document.getElementById('meetingModal').style.display = 'none';
    document.body.classList.remove('modal-open');
    _editingProjectMeetingId = null;
}

/** Salva (crea o aggiorna) una riunione di progetto. */
export async function saveProjectMeeting() {
    const project = state.projects.find(p => p.id === state.currentProjectId);
    if (!project) return;

    const date         = document.getElementById('meetingDate').value;
    const subject      = document.getElementById('meetingSubject').value.trim();
    const participants = document.getElementById('meetingParticipants').value.trim();
    const topics       = document.getElementById('meetingTopics').value;

    if (!date || !subject || !participants) {
        alert('⚠️ Compila tutti i campi obbligatori');
        return;
    }

    const meeting = { date, subject, participants, topics };

    if (!project.meetings) project.meetings = [];

    if (_editingProjectMeetingId !== null) {
        const sorted = [...project.meetings].sort((a, b) => new Date(b.date) - new Date(a.date));
        const meetingToUpdate = sorted[_editingProjectMeetingId];
        const originalIndex = project.meetings.indexOf(meetingToUpdate);
        project.meetings[originalIndex] = meeting;
    } else {
        project.meetings.push(meeting);
    }

    await db.save('projects', project);
    closeProjectMeetingModal();
    renderProjectMeetings();
}

/** Elimina una riunione di progetto per indice nella vista ordinata. */
export async function deleteProjectMeeting(index) {
    if (!confirm('Eliminare questa riunione?')) return;

    const project = state.projects.find(p => p.id === state.currentProjectId);
    if (!project || !project.meetings) return;

    const sorted = [...project.meetings].sort((a, b) => new Date(b.date) - new Date(a.date));
    const meetingToDelete = sorted[index];
    const originalIndex = project.meetings.indexOf(meetingToDelete);
    if (originalIndex > -1) project.meetings.splice(originalIndex, 1);

    await db.save('projects', project);
    renderProjectMeetings();
}

// ─── Riunioni Globali ──────────────────────────────────────────────────────────

/** Renderizza la tabella delle riunioni globali aziendali. */
export function renderGlobalMeetings() {
    const tbody = document.querySelector('#globalMeetingsTable tbody');
    tbody.innerHTML = '';

    const filterTag      = document.getElementById('meetingFilterTag')?.value.toLowerCase()      || '';
    const filterSubject  = document.getElementById('meetingFilterSubject')?.value.toLowerCase()  || '';
    const filterResource = document.getElementById('meetingFilterResource')?.value.toLowerCase() || '';

    let filteredMeetings = state.meetings.filter(meeting => {
        if (filterTag && (!meeting.tags || !meeting.tags.toLowerCase().includes(filterTag))) return false;
        if (filterSubject && (!meeting.subject || !meeting.subject.toLowerCase().includes(filterSubject))) return false;
        if (filterResource) {
            const resourceNames = (meeting.resourceIds || [])
                .map(id => getResourceName(id).toLowerCase())
                .join(' ');
            if (!resourceNames.includes(filterResource)) return false;
        }
        return true;
    });

    filteredMeetings.sort((a, b) => {
        const dateA = new Date(a.date + (a.time ? 'T' + a.time : 'T00:00'));
        const dateB = new Date(b.date + (b.time ? 'T' + b.time : 'T00:00'));
        return dateA - dateB;
    });

    const now = new Date();
    let nextMeetingId = null;
    for (const meeting of filteredMeetings) {
        const meetingStart = new Date(meeting.date + (meeting.time ? 'T' + meeting.time : 'T00:00'));
        let meetingEnd = new Date(meetingStart);
        if (meeting.expectedDuration) {
            const durationMinutes = parseDurationToMinutes(meeting.expectedDuration);
            meetingEnd = new Date(meetingStart.getTime() + durationMinutes * 60000);
        }
        if (meetingEnd >= now) { nextMeetingId = meeting.id; break; }
    }

    filteredMeetings.forEach(meeting => {
        const row          = tbody.insertRow();
        const date         = new Date(meeting.date);
        const meetingDateTime = new Date(meeting.date + (meeting.time ? 'T' + meeting.time : 'T00:00'));
        let meetingEndDateTime = new Date(meetingDateTime);
        if (meeting.expectedDuration) {
            const durationMinutes = parseDurationToMinutes(meeting.expectedDuration);
            meetingEndDateTime = new Date(meetingDateTime.getTime() + durationMinutes * 60000);
        }
        const isPast       = meetingEndDateTime < now;
        const isInProgress = meetingDateTime <= now && meetingEndDateTime >= now;
        const isNext       = meeting.id === nextMeetingId;

        row.style.cursor = 'pointer';
        if (isInProgress) {
            row.classList.add('meeting-in-progress');
        } else if (isPast) {
            row.style.opacity = '0.5';
        } else if (isNext) {
            row.style.backgroundColor = 'var(--accent-color-light)';
            row.style.fontWeight = '600';
        }

        row.onclick = function (e) {
            if (e.target.tagName !== 'BUTTON') viewGlobalMeeting(meeting.id);
        };

        const resourceNames = (meeting.resourceIds || []).map(id => getResourceName(id)).join(', ');
        const seriesIndicator = meeting.seriesId ? '🔁 ' : '';

        row.innerHTML = `
            <td>${seriesIndicator}${date.toLocaleDateString('it-IT')}${meeting.time ? ' ' + meeting.time : ''}</td>
            <td>${escapeHtml(meeting.subject)}</td>
            <td>${escapeHtml(meeting.tags || '')}</td>
            <td>${resourceNames || '-'}</td>
            <td>${meeting.expectedDuration ? meeting.expectedDuration : '-'}</td>
            <td>${meeting.actualDuration ? meeting.actualDuration : '-'}</td>
            <td>
                <button onclick="event.stopPropagation(); editGlobalMeeting('${meeting.id}')" title="Modifica" style="padding: 4px 8px; font-size: 12px;">✏️</button>
                <button onclick="event.stopPropagation(); deleteGlobalMeeting('${meeting.id}')" title="Elimina" class="delete" style="padding: 4px 8px; font-size: 12px;">🗑️</button>
            </td>
        `;
    });

    if (filteredMeetings.length === 0) {
        const row = tbody.insertRow();
        row.innerHTML = '<td colspan="7" style="text-align: center; color: var(--text-tertiary); font-style: italic;">Nessuna riunione trovata</td>';
    }
}

/** Mostra/nasconde i campi ricorrenza nel form riunione globale. */
export function toggleRecurringFields() {
    const isRecurring = document.getElementById('globalMeetingRecurring').checked;
    const container   = document.getElementById('recurringFieldsContainer');
    container.style.display = isRecurring ? 'block' : 'none';
}

/** Apre il modal per creare, modificare o visualizzare una riunione globale. */
export function openGlobalMeetingModal(meetingId = null, viewOnly = false) {
    const modal = document.getElementById('globalMeetingModal');
    const title = document.getElementById('globalMeetingModalTitle');

    _editingGlobalMeetingId = meetingId;

    // Popola la lista delle risorse
    const resourcesContainer = document.getElementById('globalMeetingResourcesContainer');
    resourcesContainer.innerHTML = '';
    state.resources.forEach(resource => {
        const fullName = `${resource.firstName || ''} ${resource.lastName || ''}`.trim();
        const wrap = document.createElement('div');
        wrap.style.marginBottom = '6px';
        wrap.innerHTML = `
            <input type="checkbox" id="meetingRes_${resource.id}" value="${resource.id}" ${viewOnly ? 'disabled' : ''}>
            <label for="meetingRes_${resource.id}" style="cursor: pointer; user-select: none;">${fullName || 'Sconosciuto'}</label>
        `;
        resourcesContainer.appendChild(wrap);
    });

    if (meetingId) {
        const meeting = state.meetings.find(m => m.id === meetingId);
        if (meeting) {
            title.textContent = viewOnly ? '👀 Visualizza Riunione' : '✏️ Modifica Riunione';
            if (meeting.seriesId) title.textContent += ' (Ricorsiva)';

            document.getElementById('globalMeetingDate').value             = meeting.date;
            document.getElementById('globalMeetingTime').value             = meeting.time || '';
            document.getElementById('globalMeetingSubject').value          = meeting.subject;
            document.getElementById('globalMeetingTags').value             = meeting.tags || '';
            document.getElementById('globalMeetingExpectedDuration').value = meeting.expectedDuration || '';
            document.getElementById('globalMeetingActualDuration').value   = meeting.actualDuration || '';
            document.getElementById('globalMeetingDescription').value      = meeting.description || '';
            document.getElementById('globalMeetingMinutes').value          = meeting.minutes || '';

            // Nascondi campi ricorrenza per riunioni esistenti
            const recurringGroup = document.getElementById('globalMeetingRecurring')?.closest('.form-group');
            if (recurringGroup) recurringGroup.style.display = 'none';
            document.getElementById('recurringFieldsContainer').style.display = 'none';

            (meeting.resourceIds || []).forEach(resId => {
                const checkbox = document.getElementById('meetingRes_' + resId);
                if (checkbox) checkbox.checked = true;
            });
        }
    } else {
        title.textContent = '👥 Nuova Riunione';
        document.getElementById('globalMeetingDate').value             = '';
        document.getElementById('globalMeetingTime').value             = '';
        document.getElementById('globalMeetingSubject').value          = '';
        document.getElementById('globalMeetingTags').value             = '';
        document.getElementById('globalMeetingExpectedDuration').value = '';
        document.getElementById('globalMeetingActualDuration').value   = '';
        document.getElementById('globalMeetingDescription').value      = '';
        document.getElementById('globalMeetingMinutes').value          = '';

        const recurringGroup = document.getElementById('globalMeetingRecurring')?.closest('.form-group');
        if (recurringGroup) recurringGroup.style.display = 'flex';
    }

    // Abilita/disabilita tutti i campi del modal
    document.querySelectorAll('#globalMeetingModal input, #globalMeetingModal textarea, #globalMeetingModal select')
        .forEach(el => { el.disabled = viewOnly; });

    openModal(modal);
}

/** Chiude il modal riunione globale e resetta lo stato. */
export function closeGlobalMeetingModal() {
    closeModal(document.getElementById('globalMeetingModal'));
    _editingGlobalMeetingId = null;

    document.getElementById('globalMeetingRecurring').checked = false;
    document.getElementById('globalMeetingEndDate').value = '';
    document.getElementById('globalMeetingWeekInterval').value = '1';
    document.querySelectorAll('.recurring-day').forEach(cb => { cb.checked = false; });
    document.getElementById('recurringFieldsContainer').style.display = 'none';
}

/** Salva una riunione globale (singola o serie ricorrente). */
export async function saveGlobalMeeting() {
    const startDate        = document.getElementById('globalMeetingDate').value;
    const time             = document.getElementById('globalMeetingTime').value;
    const subject          = document.getElementById('globalMeetingSubject').value.trim();
    const tags             = document.getElementById('globalMeetingTags').value.trim();
    const expectedDuration = document.getElementById('globalMeetingExpectedDuration').value;
    const actualDuration   = document.getElementById('globalMeetingActualDuration').value;
    const description      = document.getElementById('globalMeetingDescription').value;
    const minutes          = document.getElementById('globalMeetingMinutes').value;
    const isRecurring      = document.getElementById('globalMeetingRecurring').checked;

    if (!startDate || !subject) {
        alert('⚠️ Compila almeno Data e Oggetto');
        return;
    }

    // Raccogli risorse selezionate
    const resourceIds = [];
    state.resources.forEach(resource => {
        const checkbox = document.getElementById('meetingRes_' + resource.id);
        if (checkbox && checkbox.checked) resourceIds.push(resource.id);
    });

    if (resourceIds.length === 0) {
        alert('⚠️ Seleziona almeno una risorsa');
        return;
    }

    let updatedMeetings = [...state.meetings];
    const toSave    = [];  // nuove/aggiornate da salvare su DB
    const toRemove  = [];  // da rimuovere dal DB

    if (isRecurring) {
        const endDate = document.getElementById('globalMeetingEndDate').value;
        if (!endDate) { alert('⚠️ Specifica la data fine per la riunione ricorsiva'); return; }

        const selectedDays = [];
        document.querySelectorAll('.recurring-day:checked').forEach(cb => {
            selectedDays.push(parseInt(cb.value));
        });
        if (selectedDays.length === 0) { alert('⚠️ Seleziona almeno un giorno della settimana'); return; }

        // Rimuovi serie esistente se in modifica
        if (_editingGlobalMeetingId) {
            const editingMeeting = updatedMeetings.find(m => m.id === _editingGlobalMeetingId);
            if (editingMeeting && editingMeeting.seriesId) {
                toRemove.push(...updatedMeetings.filter(m => m.seriesId === editingMeeting.seriesId));
                updatedMeetings = updatedMeetings.filter(m => m.seriesId !== editingMeeting.seriesId);
            } else {
                toRemove.push(...updatedMeetings.filter(m => m.id === _editingGlobalMeetingId));
                updatedMeetings = updatedMeetings.filter(m => m.id !== _editingGlobalMeetingId);
            }
        }

        const weekInterval = parseInt(document.getElementById('globalMeetingWeekInterval').value) || 1;
        const seriesId     = 'series_' + Date.now();
        const start        = new Date(startDate);
        const end          = new Date(endDate);

        const firstWeekStart = new Date(start);
        firstWeekStart.setDate(start.getDate() - start.getDay()); // alla domenica precedente

        const baseTime = Date.now();
        let counter = 0;
        let currentWeekStart = new Date(firstWeekStart);
        while (currentWeekStart <= end) {
            for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
                const current = new Date(currentWeekStart);
                current.setDate(currentWeekStart.getDate() + dayOffset);
                if (current >= start && current <= end) {
                    const dayOfWeek = current.getDay();
                    if (selectedDays.includes(dayOfWeek)) {
                        const meeting = {
                            id: 'meeting_' + baseTime + '_' + (++counter),
                            date: current.toISOString().split('T')[0],
                            time, subject, tags, resourceIds,
                            expectedDuration: expectedDuration || null,
                            actualDuration:   actualDuration   || null,
                            description, minutes,
                            seriesId, isRecurring: true, weekInterval
                        };
                        updatedMeetings.push(meeting);
                        toSave.push(meeting);
                    }
                }
            }
            currentWeekStart.setDate(currentWeekStart.getDate() + 7 * weekInterval);
        }
    } else {
        // Riunione singola
        const meeting = {
            id: _editingGlobalMeetingId || 'meeting_' + Date.now(),
            date: startDate, time, subject, tags, resourceIds,
            expectedDuration: expectedDuration || null,
            actualDuration:   actualDuration   || null,
            description, minutes
        };

        if (_editingGlobalMeetingId) {
            const index = updatedMeetings.findIndex(m => m.id === _editingGlobalMeetingId);
            if (index > -1) updatedMeetings[index] = meeting;
        } else {
            updatedMeetings.push(meeting);
        }
        toSave.push(meeting);
    }

    state.setMeetings(updatedMeetings);

    // Persistenza: prima rimuovi, poi salva
    for (const m of toRemove) await db.remove('meetings', m.id);
    for (const m of toSave)   await db.save('meetings', m);

    closeGlobalMeetingModal();
    renderGlobalMeetings();
    updateMeetingTagsSuggestions();
}

/** Apre il modal di modifica per una riunione globale. */
export function editGlobalMeeting(meetingId) {
    openGlobalMeetingModal(meetingId);
}

/** Apre il modal di visualizzazione per una riunione globale. */
export function viewGlobalMeeting(meetingId) {
    openGlobalMeetingModal(meetingId, true);
}

/** Elimina una riunione globale. */
export async function deleteGlobalMeeting(meetingId) {
    if (!confirm('Eliminare questa riunione?')) return;

    state.setMeetings(state.meetings.filter(m => m.id !== meetingId));
    await db.remove('meetings', meetingId);

    renderGlobalMeetings();
    updateMeetingTagsSuggestions();
}
