/**
 * js/modules/resourceView.js
 *
 * Rendering della Vista Risorse (tab "Vista Risorse"): timeline settimanale/mensile
 * con barre di carico, assegnazioni task, suggerimenti attività flessibili.
 *
 * Dipendenze v2:
 *   - ../state.js    → resources, projects, meetings, holidays, plants,
 *                      collapsedResources, currentProjectId, setCurrentProjectId,
 *                      suggestedStartDate, setSuggestedStartDate,
 *                      suggestedResourceId, setSuggestedResourceId
 *   - ../helpers.js  → formatDateLocal, escapeHtml, getResourceName, parseDateLocal,
 *                      hoursToHHMM, getLocationBadgeHtml, areAllResourcesAbsent,
 *                      hasAnyResourceAbsent, calculateEndDateForTask
 *
 * Funzioni esposte su window da app.js:
 *   window.renderResourceView        = ResourceView.renderResourceView
 *   window.updateResourceViewPeriod  = ResourceView.updateResourceViewPeriod
 *   window.updateResourceViewFilters = ResourceView.updateResourceViewFilters
 *   window.resourceViewPrev          = ResourceView.resourceViewPrev
 *   window.resourceViewNext          = ResourceView.resourceViewNext
 *   window.resourceViewToday         = ResourceView.resourceViewToday
 *   window.expandAllResources        = ResourceView.expandAllResources
 *   window.collapseAllResources      = ResourceView.collapseAllResources
 */

import * as state from '../state.js';
import * as Auth  from './auth.js';
import {
    formatDateLocal,
    escapeHtml,
    getResourceName,
    parseDateLocal,
    hoursToHHMM,
    getLocationBadgeHtml,
    areAllResourcesAbsent,
    hasAnyResourceAbsent,
    calculateEndDateForTask
} from '../helpers.js';

// ─── Navigazione ──────────────────────────────────────────────────────────────

export function resourceViewPrev()  { navigateResourceView(-1); }
export function resourceViewNext()  { navigateResourceView(1);  }
export function resourceViewToday() { goToCurrentPeriod();       }

// ─── Filtri / Periodo ─────────────────────────────────────────────────────────

export function updateResourceViewPeriod() {
    const period              = document.getElementById('resourceViewPeriod').value;
    const customRange         = document.getElementById('customDateRange');
    const specificDayRange    = document.getElementById('specificDayRange');
    const specificWeekRange   = document.getElementById('specificWeekRange');
    const specificMonthRange  = document.getElementById('specificMonthRange');
    const specificYearRange   = document.getElementById('specificYearRange');
    const startDateInput      = document.getElementById('resourceViewStartDate');
    const endDateInput        = document.getElementById('resourceViewEndDate');

    // Nascondi tutti
    customRange.style.display        = 'none';
    specificDayRange.style.display   = 'none';
    specificWeekRange.style.display  = 'none';
    specificMonthRange.style.display = 'none';
    specificYearRange.style.display  = 'none';

    if (period === 'custom') {
        customRange.style.display = 'flex';
        return;
    } else if (period === 'day') {
        specificDayRange.style.display = 'flex';
        const dayInput = document.getElementById('resourceViewSpecificDay');
        if (!dayInput.value) dayInput.value = formatDateLocal(new Date());
        updateDayOfWeekLabel();
        renderResourceView();
        return;
    } else if (period === 'week') {
        specificWeekRange.style.display = 'flex';
        populateWeekSelector();
        return;
    } else if (period === 'month') {
        specificMonthRange.style.display = 'flex';
        populateMonthSelector();
        return;
    } else if (period === 'year') {
        specificYearRange.style.display = 'flex';
        populateYearSelector();
        return;
    } else if (period === 'all') {
        const dateRange = getProjectsDateRange();
        if (dateRange.minDate && dateRange.maxDate) {
            startDateInput.value = formatDateLocal(dateRange.minDate);
            endDateInput.value   = formatDateLocal(dateRange.maxDate);
            renderResourceView();
        }
        return;
    } else if (period === 'quarter') {
        const today = new Date();
        startDateInput.value = formatDateLocal(today);
        const endDate = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
        endDateInput.value = formatDateLocal(endDate);
    }

    renderResourceView();
}

export function updateResourceViewFilters() {
    const resourceSelect = document.getElementById('resourceViewFilter');
    if (resourceSelect) {
        const currentValue = resourceSelect.value;
        resourceSelect.innerHTML = '<option value="">Tutte le Risorse</option>';
        state.resources.forEach(r => {
            const option = document.createElement('option');
            option.value       = r.id;
            option.textContent = `${r.firstName} ${r.lastName}`;
            if (r.id == currentValue) option.selected = true;
            resourceSelect.appendChild(option);
        });

        // Utente personal: blocca il filtro sulla propria risorsa
        const _fUser = Auth.getCurrentUser();
        if (_fUser?.role === 'personal' && _fUser?.resourceId) {
            resourceSelect.value    = _fUser.resourceId;
            resourceSelect.disabled = true;
        } else {
            resourceSelect.disabled = false;
        }
    }

    const startDateInput = document.getElementById('resourceViewStartDate');
    const endDateInput   = document.getElementById('resourceViewEndDate');
    if (startDateInput && !startDateInput.value) {
        startDateInput.value = formatDateLocal(new Date());
    }
    if (endDateInput && !endDateInput.value) {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        endDateInput.value = formatDateLocal(endDate);
    }
}

// ─── Rendering principale ─────────────────────────────────────────────────────

export function renderResourceView() {
    const resourceFilter = document.getElementById('resourceViewFilter')?.value;
    const period         = document.getElementById('resourceViewPeriod')?.value;
    const startDateInput = document.getElementById('resourceViewStartDate')?.value;
    const endDateInput   = document.getElementById('resourceViewEndDate')?.value;
    const container      = document.getElementById('resourceViewContainer');

    if (!container) return;

    // Salva stati collapse prima di cancellare il DOM
    container.querySelectorAll('.resource-card').forEach(card => {
        const resourceId     = card.dataset.resourceId;
        const contentWrapper = card.querySelector('.resource-content');
        if (resourceId && contentWrapper) {
            state.collapsedResources[resourceId] = contentWrapper.style.display === 'none';
        }
    });

    container.innerHTML = '';

    // Calcola date in base al periodo
    let startDate, endDate;

    if ((period === 'custom' || period === 'all') && startDateInput && endDateInput) {
        startDate = new Date(startDateInput);
        endDate   = new Date(endDateInput);
    } else if (period === 'day') {
        const dayValue = document.getElementById('resourceViewSpecificDay')?.value;
        if (dayValue) {
            startDate = new Date(dayValue); startDate.setHours(0, 0, 0, 0);
            endDate   = new Date(dayValue); endDate.setHours(23, 59, 59, 999);
        } else {
            startDate = new Date(); startDate.setHours(0, 0, 0, 0);
            endDate   = new Date(); endDate.setHours(23, 59, 59, 999);
        }
    } else if (period === 'week') {
        const weekStart = document.getElementById('resourceViewSpecificWeek')?.value;
        if (weekStart) {
            startDate = new Date(weekStart);
            endDate   = new Date(startDate); endDate.setDate(endDate.getDate() + 6);
        } else {
            startDate = new Date();
            endDate   = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
    } else if (period === 'month') {
        const monthValue = document.getElementById('resourceViewSpecificMonth')?.value;
        if (monthValue) {
            const [year, month] = monthValue.split('-').map(Number);
            startDate = new Date(year, month - 1, 1);
            endDate   = new Date(year, month, 0);
        } else {
            startDate = new Date();
            endDate   = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        }
    } else if (period === 'year') {
        const yearValue = document.getElementById('resourceViewSpecificYear')?.value;
        if (yearValue) {
            const year = parseInt(yearValue);
            startDate = new Date(year, 0, 1);
            endDate   = new Date(year, 11, 31);
        } else {
            startDate = new Date();
            endDate   = new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
        }
    } else if (period === 'quarter') {
        startDate = new Date();
        endDate   = new Date(startDate.getTime() + 90 * 24 * 60 * 60 * 1000);
    } else {
        startDate = new Date();
        endDate   = new Date();
    }

    // Filtro risorse per ruolo
    const _rvUser = Auth.getCurrentUser();
    const _rvIsPersonal = _rvUser?.role === 'personal' && _rvUser?.resourceId;
    const _rvIsEditor   = _rvUser?.role === 'editor'
        && Array.isArray(_rvUser?.allowedResourceTypes)
        && _rvUser.allowedResourceTypes.length > 0;

    let filteredResources;
    if (_rvIsPersonal) {
        filteredResources = state.resources.filter(r => r.id == _rvUser.resourceId);
    } else if (_rvIsEditor) {
        const editorTypes = new Set(_rvUser.allowedResourceTypes);
        const base = resourceFilter
            ? state.resources.filter(r => r.id == resourceFilter)
            : state.resources.filter(r => !r.hidden);
        filteredResources = base.filter(r => editorTypes.has(r.type));
    } else {
        filteredResources = resourceFilter
            ? state.resources.filter(r => r.id == resourceFilter)
            : state.resources.filter(r => !r.hidden);
    }

    if (filteredResources.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center;">Nessuna risorsa disponibile.</p>';
        return;
    }

    filteredResources.forEach(resource => {
        const card = createResourceCard(resource, startDate, endDate, period);
        container.appendChild(card);
    });
}

// ─── Expand / Collapse tutte le risorse ──────────────────────────────────────

export function expandAllResources() {
    const container = document.getElementById('resourceViewContainer');
    if (!container) return;
    container.querySelectorAll('.resource-card').forEach(card => {
        const resourceId     = card.dataset.resourceId;
        const contentWrapper = card.querySelector('.resource-content');
        const indicator      = card.querySelector('.resource-header span');
        if (contentWrapper && resourceId) {
            contentWrapper.style.display = 'block';
            if (indicator) indicator.style.transform = 'rotate(0deg)';
            state.collapsedResources[resourceId] = false;
        }
    });
}

export function collapseAllResources() {
    const container = document.getElementById('resourceViewContainer');
    if (!container) return;
    container.querySelectorAll('.resource-card').forEach(card => {
        const resourceId     = card.dataset.resourceId;
        const contentWrapper = card.querySelector('.resource-content');
        const indicator      = card.querySelector('.resource-header span');
        if (contentWrapper && resourceId) {
            contentWrapper.style.display = 'none';
            if (indicator) indicator.style.transform = 'rotate(-90deg)';
            state.collapsedResources[resourceId] = true;
        }
    });
}

// ─── Helpers privati: navigazione ────────────────────────────────────────────

function navigateResourceView(direction) {
    const period = document.getElementById('resourceViewPeriod').value;

    if (period === 'day') {
        const dayInput    = document.getElementById('resourceViewSpecificDay');
        const currentDate = new Date(dayInput.value);
        currentDate.setDate(currentDate.getDate() + direction);
        dayInput.value = formatDateLocal(currentDate);
        updateDayOfWeekLabel();
        renderResourceView();
    } else if (period === 'week') {
        const weekSelect  = document.getElementById('resourceViewSpecificWeek');
        const newIndex    = weekSelect.selectedIndex + direction;
        if (newIndex >= 0 && newIndex < weekSelect.options.length) {
            weekSelect.selectedIndex = newIndex;
            renderResourceView();
        }
    } else if (period === 'month') {
        const monthSelect = document.getElementById('resourceViewSpecificMonth');
        const newIndex    = monthSelect.selectedIndex + direction;
        if (newIndex >= 0 && newIndex < monthSelect.options.length) {
            monthSelect.selectedIndex = newIndex;
            renderResourceView();
        }
    } else if (period === 'year') {
        const yearSelect = document.getElementById('resourceViewSpecificYear');
        const newIndex   = yearSelect.selectedIndex + direction;
        if (newIndex >= 0 && newIndex < yearSelect.options.length) {
            yearSelect.selectedIndex = newIndex;
            renderResourceView();
        }
    }
}

function goToCurrentPeriod() {
    const period = document.getElementById('resourceViewPeriod').value;
    const today  = new Date();

    if (period === 'day') {
        const dayInput = document.getElementById('resourceViewSpecificDay');
        dayInput.value = formatDateLocal(today);
        updateDayOfWeekLabel();
        renderResourceView();
    } else if (period === 'week') {
        populateWeekSelector();
    } else if (period === 'month') {
        populateMonthSelector();
    } else if (period === 'year') {
        populateYearSelector();
    }
    renderResourceView();
}

function updateDayOfWeekLabel() {
    const dayInput = document.getElementById('resourceViewSpecificDay');
    const label    = document.getElementById('dayOfWeekLabel');
    if (!dayInput || !label) return;
    const dateValue = dayInput.value;
    if (!dateValue) { label.textContent = ''; return; }
    const date     = new Date(dateValue + 'T00:00:00');
    const dayNames = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    label.textContent = dayNames[date.getDay()];
}

// ─── Helpers privati: date range ──────────────────────────────────────────────

function getProjectsDateRange() {
    let minDate = null;
    let maxDate = null;
    state.projects.forEach(project => {
        if (project.milestones) {
            project.milestones.forEach(m => {
                if (m.date) {
                    const d = new Date(m.date);
                    if (!minDate || d < minDate) minDate = d;
                    if (!maxDate || d > maxDate) maxDate = d;
                }
            });
        }
        if (project.tasks) {
            project.tasks.forEach(task => {
                if (task.startDate) {
                    const s = new Date(task.startDate);
                    if (!minDate || s < minDate) minDate = s;
                }
                if (task.endDate) {
                    const e = new Date(task.endDate);
                    if (!maxDate || e > maxDate) maxDate = e;
                }
            });
        }
    });
    return { minDate, maxDate };
}

function populateWeekSelector() {
    const select    = document.getElementById('resourceViewSpecificWeek');
    const dateRange = getProjectsDateRange();
    if (!dateRange.minDate || !dateRange.maxDate) {
        select.innerHTML = '<option value="">Nessun progetto</option>';
        return;
    }

    select.innerHTML = '';
    const today            = new Date();
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay() + 1);

    let weekStart = new Date(dateRange.minDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);

    let selectedSet = false;
    while (weekStart <= dateRange.maxDate) {
        const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);

        const tempDate = new Date(weekStart.getTime());
        tempDate.setHours(0, 0, 0, 0);
        tempDate.setDate(tempDate.getDate() + 3 - (tempDate.getDay() + 6) % 7);
        const week1          = new Date(tempDate.getFullYear(), 0, 4);
        const isoWeekNumber  = 1 + Math.round(((tempDate.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);

        const option = document.createElement('option');
        option.value       = formatDateLocal(weekStart);
        option.textContent = `Sett. ${isoWeekNumber}/${weekStart.getFullYear()} (${formatDateLocal(weekStart)} - ${formatDateLocal(weekEnd)})`;
        if (!selectedSet && weekStart <= currentWeekStart && weekEnd >= currentWeekStart) {
            option.selected = true;
            selectedSet = true;
        }
        select.appendChild(option);
        weekStart.setDate(weekStart.getDate() + 7);
    }
    renderResourceView();
}

function populateMonthSelector() {
    const select    = document.getElementById('resourceViewSpecificMonth');
    const dateRange = getProjectsDateRange();
    if (!dateRange.minDate || !dateRange.maxDate) {
        select.innerHTML = '<option value="">Nessun progetto</option>';
        return;
    }

    select.innerHTML = '';
    const monthNames    = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                           'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    const currentMonth  = new Date().getMonth();
    const currentYear   = new Date().getFullYear();
    let year  = dateRange.minDate.getFullYear();
    let month = dateRange.minDate.getMonth();
    const endYear  = dateRange.maxDate.getFullYear();
    const endMonth = dateRange.maxDate.getMonth();

    let selectedSet = false;
    while (year < endYear || (year === endYear && month <= endMonth)) {
        const option = document.createElement('option');
        option.value       = `${year}-${String(month + 1).padStart(2, '0')}`;
        option.textContent = `${monthNames[month]} ${year}`;
        if (!selectedSet && year === currentYear && month === currentMonth) {
            option.selected = true;
            selectedSet = true;
        }
        select.appendChild(option);
        month++;
        if (month > 11) { month = 0; year++; }
    }
    renderResourceView();
}

function populateYearSelector() {
    const select    = document.getElementById('resourceViewSpecificYear');
    const dateRange = getProjectsDateRange();
    if (!dateRange.minDate || !dateRange.maxDate) {
        select.innerHTML = '<option value="">Nessun progetto</option>';
        return;
    }

    select.innerHTML = '';
    const currentYear = new Date().getFullYear();
    const startYear   = dateRange.minDate.getFullYear();
    const endYear     = dateRange.maxDate.getFullYear();

    for (let year = startYear; year <= endYear; year++) {
        const option = document.createElement('option');
        option.value       = year;
        option.textContent = year;
        if (year === currentYear) option.selected = true;
        select.appendChild(option);
    }
    renderResourceView();
}

// ─── Helpers privati: task ────────────────────────────────────────────────────

function hasAssignedResources(task) {
    if (!task.resources || task.resources.length === 0) return false;
    return task.resources.some(r => r.resourceId && r.resourceId !== null && r.resourceId !== '');
}

function getEffectiveEndDateForResource(task, resourceId) {
    if (!task.endDate) return task.endDate;

    const res           = task.resources && task.resources.find(r => r.resourceId == resourceId);
    const resCompletion = res ? (parseInt(res.completion, 10) || 0) : (parseInt(task.completion, 10) || 0);

    if (resCompletion >= 100 && task.completion < 100) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = formatDateLocal(yesterday);
        return task.endDate > yesterdayStr ? yesterdayStr : task.endDate;
    }

    if (task.status === 'in-ritardo' && task.completion < 100) {
        const today = formatDateLocal(new Date());
        if (task.endDate < today) return today;
    }

    return task.endDate;
}

// ─── Helpers privati: stato scroll ───────────────────────────────────────────

export function saveResourceViewState() {
    const container = document.getElementById('resourceViewContainer');
    if (!container) return null;
    return {
        scrollTop:     container.scrollTop,
        filterValue:   document.getElementById('resourceViewFilter')?.value   || '',
        periodValue:   document.getElementById('resourceViewPeriod')?.value   || 'week',
        startDate:     document.getElementById('resourceViewStartDate')?.value || '',
        endDate:       document.getElementById('resourceViewEndDate')?.value   || '',
        specificDay:   document.getElementById('resourceViewSpecificDay')?.value   || '',
        specificWeek:  document.getElementById('resourceViewSpecificWeek')?.value  || '',
        specificMonth: document.getElementById('resourceViewSpecificMonth')?.value || '',
        specificYear:  document.getElementById('resourceViewSpecificYear')?.value  || ''
    };
}

export function restoreResourceViewState(savedState) {
    if (!savedState) return;
    const container = document.getElementById('resourceViewContainer');
    if (!container)  return;

    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };

    set('resourceViewFilter',        savedState.filterValue);
    set('resourceViewPeriod',        savedState.periodValue);
    set('resourceViewStartDate',     savedState.startDate);
    set('resourceViewEndDate',       savedState.endDate);
    set('resourceViewSpecificDay',   savedState.specificDay);
    set('resourceViewSpecificWeek',  savedState.specificWeek);
    set('resourceViewSpecificMonth', savedState.specificMonth);
    set('resourceViewSpecificYear',  savedState.specificYear);

    setTimeout(() => {
        if (savedState.scrollTop !== undefined) container.scrollTop = savedState.scrollTop;
    }, 50);
}

// ─── Rendering card risorsa ───────────────────────────────────────────────────

function createResourceCard(resource, startDate, endDate, period) {
    const card = document.createElement('div');
    card.className = 'resource-card';
    card.dataset.resourceId = resource.id;

    const hideCompleted = document.getElementById('resourceViewHideCompleted')?.checked || false;
    const hidePaused    = document.getElementById('resourceViewHidePaused')?.checked    || false;

    // Raccolta assegnazioni task nel periodo
    const assignments = [];
    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (hideCompleted && (task.completion >= 100 || task.status === 'completata')) return;
            if (hidePaused    && task.status === 'pausa') return;
            if (!task.resources || !task.startDate || !task.endDate) return;

            const res = task.resources.find(r => r.resourceId == resource.id);
            if (!res) return;

            const effectiveEnd = getEffectiveEndDateForResource(task, resource.id);
            const taskStart    = new Date(task.startDate); taskStart.setHours(0, 0, 0, 0);
            const taskEnd      = new Date(effectiveEnd);   taskEnd.setHours(23, 59, 59, 999);

            if (taskEnd >= startDate && taskStart <= endDate) {
                assignments.push({
                    type: 'task',
                    project,
                    task,
                    percentage:      res.percentage,
                    resourceId:      resource.id,
                    startDate:       task.startDate,
                    endDate:         effectiveEnd,
                    originalEndDate: task.endDate,
                    isDelayExtended: effectiveEnd > task.endDate
                });
            }
        });
    });

    // Riunioni per questa risorsa
    state.meetings.forEach(meeting => {
        if (meeting.resourceIds && meeting.resourceIds.includes(resource.id)) {
            const meetingDate  = new Date(meeting.date); meetingDate.setHours(0, 0, 0, 0);
            const periodStart  = new Date(startDate);    periodStart.setHours(0, 0, 0, 0);
            const periodEnd    = new Date(endDate);      periodEnd.setHours(23, 59, 59, 999);
            if (meetingDate >= periodStart && meetingDate <= periodEnd) {
                assignments.push({ type: 'meeting', meeting, startDate: meeting.date, endDate: meeting.date });
            }
        }
    });

    // Calcola sovraccarico (solo task)
    const taskAssignments = assignments.filter(a => a.type === 'task');
    const overload        = calculateResourceOverload(taskAssignments, startDate, endDate);
    if (overload.maxLoad > 100) card.classList.add('overloaded');

    // ── Header ────────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'resource-header';
    header.style.cursor = 'pointer';
    header.title = 'Clicca per espandere/comprimere';

    const collapseIndicator = document.createElement('span');
    collapseIndicator.textContent = '▼';
    collapseIndicator.style.marginRight  = '8px';
    collapseIndicator.style.transition   = 'transform 0.2s';
    header.appendChild(collapseIndicator);

    const nameDiv = document.createElement('div');
    nameDiv.className   = 'resource-name';
    nameDiv.textContent = `${resource.firstName} ${resource.lastName}`;
    header.appendChild(nameDiv);

    // Vista giorno: mostra carico %
    if (period === 'day') {
        const load = document.createElement('div');
        load.className = 'resource-load';
        if (overload.maxLoad <= 100) {
            load.classList.add('normal');
            load.textContent = `Carico: ${overload.maxLoad.toFixed(0)}%`;
        } else if (overload.maxLoad <= 150) {
            load.classList.add('warning');
            load.textContent = `⚠️ Sovraccarico: ${overload.maxLoad.toFixed(0)}%`;
        } else {
            load.classList.add('overload');
            load.textContent = `🛑 Critico: ${overload.maxLoad.toFixed(0)}%`;
        }
        header.appendChild(load);

        const dayStr   = formatDateLocal(startDate);
        const dayPermit = resource.permits && resource.permits.find(p => p.date === dayStr);
        if (dayPermit) {
            const permitBadge        = document.createElement('span');
            permitBadge.className    = 'resource-stat-badge absence';
            permitBadge.style.background = '#fff3e0';
            permitBadge.style.color      = '#e65100';
            permitBadge.style.marginLeft = '8px';
            permitBadge.textContent      = `⏰ Permesso ${dayPermit.startTime} - ${dayPermit.endTime}`;
            header.appendChild(permitBadge);
        }
    } else {
        // Altre viste: statistiche giorni
        const today     = new Date(); today.setHours(0, 0, 0, 0);
        const statsStart = (startDate < today && endDate >= today) ? new Date(today) : new Date(startDate);
        let workingDaysInPeriod   = 0;
        let allocatedWorkingDays  = 0;
        let extraAllocatedDays    = 0;
        let absenceDaysInPeriod   = 0;
        let permitDaysInPeriod    = 0;

        const statsDate = new Date(statsStart);
        while (statsDate <= endDate) {
            const dateStr   = formatDateLocal(statsDate);
            const dayOfWeek = statsDate.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isHoliday = state.holidays.some(h => h.date === dateStr);

            const isAbsent = resource.absences && resource.absences.some(absence => {
                const absStart = new Date(absence.start); absStart.setHours(0, 0, 0, 0);
                const absEnd   = new Date(absence.end);   absEnd.setHours(23, 59, 59, 999);
                const check    = new Date(statsDate);     check.setHours(12, 0, 0, 0);
                return check >= absStart && check <= absEnd;
            });
            const hasPermitToday = resource.permits && resource.permits.some(p => p.date === dateStr);
            const hasLoad        = overload.dailyLoad[dateStr] && overload.dailyLoad[dateStr] > 0;

            if (!isWeekend && !isHoliday) {
                if (isAbsent) { absenceDaysInPeriod++; }
                else {
                    workingDaysInPeriod++;
                    if (hasLoad) allocatedWorkingDays++;
                }
                if (hasPermitToday) permitDaysInPeriod++;
            } else {
                if (hasLoad) extraAllocatedDays++;
            }
            statsDate.setDate(statsDate.getDate() + 1);
        }

        const statsDiv = document.createElement('div');
        statsDiv.className = 'resource-stats';

        const allocBadge = document.createElement('span');
        allocBadge.className = 'resource-stat-badge allocated';
        if      (overload.maxLoad > 150) allocBadge.classList.add('overload');
        else if (overload.maxLoad > 100) allocBadge.classList.add('warning');
        allocBadge.textContent = `📊 ${allocatedWorkingDays}/${workingDaysInPeriod} gg lavorativi`;
        allocBadge.title       = `${allocatedWorkingDays} giorni allocati su ${workingDaysInPeriod} giorni lavorativi nel periodo`;
        statsDiv.appendChild(allocBadge);

        if (extraAllocatedDays > 0) {
            const extraBadge = document.createElement('span');
            extraBadge.className   = 'resource-stat-badge extra';
            extraBadge.textContent = `📅 ${extraAllocatedDays} gg extra`;
            extraBadge.title       = `${extraAllocatedDays} giorni di lavoro su weekend o festivi`;
            statsDiv.appendChild(extraBadge);
        }

        if (absenceDaysInPeriod > 0) {
            const absBadge = document.createElement('span');
            absBadge.className   = 'resource-stat-badge absence';
            absBadge.textContent = `🏖️ ${absenceDaysInPeriod} gg assenza`;
            absBadge.title       = `${absenceDaysInPeriod} giorni di assenza nel periodo`;
            statsDiv.appendChild(absBadge);
        }

        if (permitDaysInPeriod > 0) {
            const permitBadge         = document.createElement('span');
            permitBadge.className     = 'resource-stat-badge absence';
            permitBadge.style.background = '#fff3e0';
            permitBadge.style.color      = '#e65100';
            permitBadge.textContent   = `⏰ ${permitDaysInPeriod} permessi`;
            permitBadge.title         = `${permitDaysInPeriod} giorni con permesso nel periodo`;
            statsDiv.appendChild(permitBadge);
        }

        // Giorni occupati da oggi in avanti
        const todayStr        = formatDateLocal(new Date());
        const occupiedDaysSet = new Set();
        state.projects.forEach(proj => {
            if (!proj.tasks) return;
            proj.tasks.forEach(task => {
                if (!task.startDate || !task.endDate) return;
                if (task.completion >= 100 || task.status === 'completata' || task.status === 'annullata' || task.status === 'pausa') return;
                if (!task.resources) return;
                const res = task.resources.find(r => r.resourceId == resource.id);
                if (!res) return;
                const effectiveEnd = getEffectiveEndDateForResource(task, resource.id);
                if (effectiveEnd < todayStr) return;
                const fromDate = task.startDate > todayStr ? task.startDate : todayStr;
                let cur = new Date(fromDate + 'T00:00:00');
                const endD = new Date(effectiveEnd + 'T00:00:00');
                while (cur <= endD) {
                    const ds  = formatDateLocal(cur);
                    const dow = cur.getDay();
                    const isHol = state.holidays.some(h => h.date === ds);
                    if ((!task.saturdayWork ? dow !== 6 : true) &&
                        (!task.sundayWork   ? dow !== 0 : true) &&
                        (!task.holidayWork  ? !isHol    : true)) {
                        occupiedDaysSet.add(ds);
                    }
                    cur.setDate(cur.getDate() + 1);
                }
            });
        });
        const fromTodayBadge       = document.createElement('span');
        fromTodayBadge.className   = 'resource-stat-badge from-today';
        fromTodayBadge.textContent = `🗓️ ${occupiedDaysSet.size} gg da oggi`;
        fromTodayBadge.title       = 'Giorni lavorativi unici con almeno un\'attività assegnata, da oggi in avanti';
        statsDiv.appendChild(fromTodayBadge);

        header.appendChild(statsDiv);
    }

    // Badge attività in ritardo
    const delayedTasks = assignments.filter(a => a.type === 'task' && a.isDelayExtended);
    if (delayedTasks.length > 0) {
        const delayBadge        = document.createElement('span');
        delayBadge.className    = 'resource-delay-badge';
        delayBadge.textContent  = `⚠️ ${delayedTasks.length} attività in ritardo`;
        delayBadge.title        = delayedTasks.map(a => `${a.project.client} - ${a.task.name}`).join('\n');
        delayBadge.onclick = e => {
            e.stopPropagation();
            const first = delayedTasks[0];
            state.setCurrentProjectId(first.project.id);
            if (typeof window.openTaskModal === 'function') window.openTaskModal(first.task.id);
        };
        header.appendChild(delayBadge);
    }

    card.appendChild(header);

    // ── Contenitore collassabile ──────────────────────────────────────────────
    const contentWrapper   = document.createElement('div');
    contentWrapper.className = 'resource-content';

    const wasCollapsed = state.collapsedResources[resource.id] || false;
    contentWrapper.style.display = wasCollapsed ? 'none' : 'block';
    if (wasCollapsed) collapseIndicator.style.transform = 'rotate(-90deg)';

    header.onclick = () => {
        const isCollapsed = contentWrapper.style.display === 'none';
        contentWrapper.style.display           = isCollapsed ? 'block' : 'none';
        collapseIndicator.style.transform      = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
        state.collapsedResources[resource.id]  = !isCollapsed;
    };

    // ── Barra di carico giornaliero ───────────────────────────────────────────
    const isWeekView    = period === 'week';
    const isMonthView   = period === 'month';
    const isColumnView  = isWeekView || isMonthView;

    const loadBarDiv    = document.createElement('div');
    loadBarDiv.className = 'resource-load-bar';

    const loadLabel     = document.createElement('div');
    loadLabel.className = 'resource-load-bar-label';
    loadLabel.textContent = 'Carico giornaliero:';
    loadBarDiv.appendChild(loadLabel);

    const barContainer  = document.createElement('div');
    barContainer.className = 'resource-load-bar-container';
    if (isColumnView)  barContainer.classList.add('week-view');
    if (isMonthView)   barContainer.classList.add('month-view');

    const dailyLoadValues = Object.values(overload.dailyLoad);
    const maxDailyLoad    = dailyLoadValues.length > 0 ? Math.max(...dailyLoadValues, 150) : 150;

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const dateStr   = formatDateLocal(currentDate);
        const load      = overload.dailyLoad[dateStr] || 0;
        const dayOfWeek = currentDate.getDay();
        const isSaturday = dayOfWeek === 6;
        const isSunday   = dayOfWeek === 0;
        const isHoliday  = state.holidays.some(h => h.date === dateStr);

        let absenceType = null;
        const isAbsent  = resource.absences && resource.absences.some(absence => {
            const absStart = new Date(absence.start); absStart.setHours(0, 0, 0, 0);
            const absEnd   = new Date(absence.end);   absEnd.setHours(23, 59, 59, 999);
            const check    = new Date(currentDate);   check.setHours(12, 0, 0, 0);
            const inRange  = check >= absStart && check <= absEnd;
            if (inRange) absenceType = absence.type || 'vacation';
            return inRange;
        });

        let permitInfo = null;
        const hasPermit = resource.permits && resource.permits.some(permit => {
            if (permit.date === dateStr) { permitInfo = permit; return true; }
            return false;
        });

        const dayColumn = document.createElement('div');
        dayColumn.className    = 'resource-day-column';
        dayColumn.dataset.date = dateStr;

        const dailyBar    = document.createElement('div');
        dailyBar.className = 'resource-daily-bar';

        const today     = new Date(); today.setHours(0, 0, 0, 0);
        const checkDate = new Date(currentDate); checkDate.setHours(0, 0, 0, 0);
        const isToday   = checkDate.getTime() === today.getTime();
        if (isToday) dailyBar.classList.add('current-day');

        if (isAbsent) {
            if (absenceType === 'sick')                    dailyBar.classList.add('on-absence-sick');
            else if (absenceType === 'planned_intervention') dailyBar.classList.add('on-absence-planned-intervention');
            else                                           dailyBar.classList.add('on-absence');
        } else if (hasPermit)  { dailyBar.classList.add('on-permit');   }
        else if (isHoliday)    { dailyBar.classList.add('on-holiday');  }
        else if (isSunday)     { dailyBar.classList.add('on-sunday');   }
        else if (isSaturday)   { dailyBar.classList.add('on-saturday'); }

        let heightPercent;
        if (load > 0) {
            heightPercent = Math.max(2, (load / maxDailyLoad) * 100);
            if (!isAbsent && !hasPermit) dailyBar.style.backgroundColor = getColorForLoad(load);
        } else {
            heightPercent = (isAbsent || hasPermit || isHoliday || isSaturday || isSunday) ? 100 : 2;
            if (!isAbsent && !hasPermit && !isHoliday && !isSaturday && !isSunday) {
                dailyBar.style.backgroundColor = 'transparent';
            }
        }
        dailyBar.style.height = `${heightPercent}%`;

        const tooltip = document.createElement('div');
        tooltip.className = 'resource-daily-bar-tooltip';
        let tooltipText = `${dateStr}: ${load.toFixed(0)}%`;
        if (isAbsent) {
            const lbl = absenceType === 'sick' ? 'MALATTIA' : (absenceType === 'planned_intervention' ? 'INTERVENTO PIANIFICATO' : 'FERIE');
            tooltipText += ` ⚠️ ${lbl}`;
        } else if (hasPermit)  { tooltipText += ` ⏰ PERMESSO ${permitInfo.startTime} - ${permitInfo.endTime}`; }
        else if (isHoliday)    { tooltipText += ' 🎉 FESTIVO';  }
        else if (isSunday)     { tooltipText += ' 📅 DOMENICA'; }
        else if (isSaturday)   { tooltipText += ' 📅 SABATO';   }
        tooltip.textContent = tooltipText;
        dailyBar.appendChild(tooltip);

        if (isColumnView) {
            const dayLabel = document.createElement('div');
            dayLabel.className = 'day-label';
            if (isToday) dayLabel.classList.add('current-day');
            const dayNames = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
            if (isMonthView) {
                dayLabel.textContent = new Date(currentDate).getDate().toString();
                dayLabel.style.fontSize = '9px';
            } else {
                dayLabel.textContent = dayNames[dayOfWeek] + ' ' + new Date(currentDate).getDate();
            }
            dayColumn.appendChild(dayLabel);
            dayColumn.appendChild(dailyBar);
            barContainer.appendChild(dayColumn);
        } else {
            barContainer.appendChild(dailyBar);
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    loadBarDiv.appendChild(barContainer);
    contentWrapper.appendChild(loadBarDiv);

    // ── Assenze ───────────────────────────────────────────────────────────────
    if (resource.absences && resource.absences.length > 0) {
        const absDiv = document.createElement('div');
        absDiv.style.cssText = 'margin-bottom:10px;font-size:13px;color:var(--text-tertiary)';
        absDiv.innerHTML = '<strong>Assenze:</strong> ' +
            resource.absences.map(a => a.start === a.end ? a.start : `${a.start} - ${a.end}`).join(', ');
        contentWrapper.appendChild(absDiv);
    }

    // ── Permessi ──────────────────────────────────────────────────────────────
    if (resource.permits && resource.permits.length > 0) {
        const permDiv = document.createElement('div');
        permDiv.style.cssText = 'margin-bottom:10px;font-size:13px;color:var(--text-tertiary)';
        permDiv.innerHTML = '<strong>⏰ Permessi:</strong> ' +
            resource.permits.map(p => `${p.date} (${p.startTime} - ${p.endTime})`).join(', ');
        contentWrapper.appendChild(permDiv);
    }

    // ── Timeline assegnazioni ─────────────────────────────────────────────────
    const assignmentsInPeriod = assignments.filter(assignment => {
        if (assignment.type === 'meeting') return true;
        const aStart = new Date(assignment.startDate); aStart.setHours(0, 0, 0, 0);
        const aEnd   = new Date(assignment.endDate);   aEnd.setHours(0, 0, 0, 0);
        const calcStart = aStart < startDate ? new Date(startDate) : new Date(aStart);
        const calcEnd   = aEnd   > endDate   ? new Date(endDate)   : new Date(aEnd);
        const cur = new Date(calcStart);
        while (cur <= calcEnd) {
            if (isWorkingDay(cur, assignment.task)) return true;
            cur.setDate(cur.getDate() + 1);
        }
        return false;
    });

    if (isColumnView) {
        // Vista settimanale/mensile: layout a colonne
        const hideSuggestions = document.getElementById('resourceViewHideSuggestions')?.checked || false;
        const flexibleTasks   = [];
        if (!hideSuggestions) {
            state.projects.forEach(project => {
                if (!project.tasks) return;
                project.tasks.forEach(task => {
                    if (!task.flexibleDate || task.completion !== 0 || task.status === 'pausa' || task.status === 'annullata') return;
                    if (hasAssignedResources(task)) {
                        const res           = task.resources.find(r => r.resourceId == resource.id);
                        const resCompletion = res ? (parseInt(res.completion, 10) || 0) : 0;
                        if (res && resCompletion < 100) flexibleTasks.push({ project, task, percentage: res.percentage });
                    } else {
                        flexibleTasks.push({ project, task, percentage: 100 });
                    }
                });
            });
        }

        if (assignmentsInPeriod.length > 0 || flexibleTasks.length > 0) {
            const weekTimeline = document.createElement('div');
            weekTimeline.className = 'resource-week-timeline';
            if (isMonthView) weekTimeline.classList.add('month-view');

            let colDate = new Date(startDate);
            while (colDate <= endDate) {
                const dateStr = formatDateLocal(colDate);
                const dayCol  = document.createElement('div');
                dayCol.className = 'week-tasks-column';
                if (isMonthView) dayCol.classList.add('month-view');

                const dailyLoad = overload.dailyLoad[dateStr] || 0;

                const checkDate = new Date(colDate); checkDate.setHours(0, 0, 0, 0);
                const dow       = colDate.getDay();
                const isSat     = dow === 6;
                const isSun     = dow === 0;
                const isHol     = state.holidays.some(h => h.date === dateStr);
                const isAbsent  = resource.absences && resource.absences.some(absence => {
                    const absStart = new Date(absence.start); absStart.setHours(0, 0, 0, 0);
                    const absEnd   = new Date(absence.end);   absEnd.setHours(23, 59, 59, 999);
                    return checkDate >= absStart && checkDate <= absEnd;
                });

                // Filtro assegnazioni per questo giorno
                const dayAssignments = assignmentsInPeriod.filter(assignment => {
                    if (assignment.type === 'meeting') {
                        const md = new Date(assignment.meeting.date); md.setHours(0, 0, 0, 0);
                        const cd = new Date(colDate);                 cd.setHours(0, 0, 0, 0);
                        return md.getTime() === cd.getTime();
                    }
                    const aStart = new Date(assignment.startDate); aStart.setHours(0, 0, 0, 0);
                    const aEnd   = new Date(assignment.endDate);   aEnd.setHours(23, 59, 59, 999);
                    const cd     = new Date(colDate);              cd.setHours(12, 0, 0, 0);
                    if (!(cd >= aStart && cd <= aEnd)) return false;
                    return isWorkingDay(colDate, assignment.task);
                });

                // Ordina: riunioni prima
                dayAssignments.sort((a, b) => {
                    if (a.type === 'meeting' && b.type !== 'meeting') return -1;
                    if (a.type !== 'meeting' && b.type === 'meeting') return 1;
                    return a.startDate.localeCompare(b.startDate);
                });

                dayAssignments.forEach(assignment => {
                    const taskCard = document.createElement('div');
                    taskCard.className    = 'week-task-card';
                    if (isMonthView) taskCard.classList.add('month-view');
                    taskCard.style.cursor = 'pointer';

                    if (assignment.type === 'meeting') {
                        const meeting = assignment.meeting;
                        taskCard.classList.add('meeting-item');
                        if (isMonthView) {
                            taskCard.innerHTML = `
                                <div style="font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🗓️ Riunione</div>
                                <div style="font-size:8px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(meeting.subject)}">${escapeHtml(meeting.subject)}</div>
                                <div style="font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${meeting.tags || ''}</div>
                            `;
                        } else {
                            taskCard.innerHTML = `
                                <div style="font-size:11px;font-weight:bold;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:white;" title="${escapeHtml(meeting.subject)}">🗓️ ${escapeHtml(meeting.subject)}</div>
                                <div style="font-size:10px;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${meeting.tags || ''}</div>
                                <div style="font-size:10px;margin-top:2px;color:white;"><span>Durata: ${meeting.expectedDuration ? meeting.expectedDuration + 'h' : '-'}</span></div>
                            `;
                        }
                        taskCard.onclick = () => { if (typeof window.viewGlobalMeeting === 'function') window.viewGlobalMeeting(meeting.id); };
                        dayCol.appendChild(taskCard);
                        return;
                    }

                    // Task
                    const status = assignment.task.status || 'nessuno';
                    if (status === 'nessuno')    taskCard.classList.add('status-none');
                    if (status === 'completata') taskCard.classList.add('status-completed');
                    if (status === 'in-corso')   taskCard.classList.add('status-in-progress');
                    if (status === 'in-ritardo') taskCard.classList.add('status-in-ritardo');
                    if (status === 'pausa')      taskCard.classList.add('status-paused');
                    if (status === 'annullata')  taskCard.classList.add('status-cancelled');
                    if (assignment.isDelayExtended)   taskCard.classList.add('delay-extended');
                    if (assignment.task.nightWork)     taskCard.classList.add('night-work');

                    const notesIndicator = assignment.task.notes && assignment.task.notes.trim()
                        ? `<span style="color:var(--warning-color);margin-left:3px;cursor:help;" title="${escapeHtml(assignment.task.notes).replace(/\n/g, '&#10;')}">📝</span>` : '';
                    const nightIndicator = assignment.task.nightWork
                        ? `<span style="margin-left:3px;cursor:help;" title="Notturno: ${assignment.task.nightWork}">🌙</span>` : '';

                    const resData       = assignment.task.resources && assignment.task.resources.find(r => r.resourceId == assignment.resourceId);
                    const resCompletion = resData ? (resData.completion || 0) : assignment.task.completion;

                    if (isMonthView) {
                        taskCard.innerHTML = `
                            <div style="font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(assignment.project.client)}">${escapeHtml(assignment.project.client)}</div>
                            <div style="font-size:8px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(assignment.project.code)}">${escapeHtml(assignment.project.code)}</div>
                            <div style="font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(assignment.task.name)}">${escapeHtml(assignment.task.name)}${notesIndicator}${nightIndicator}</div>
                            <div style="font-size:8px;margin-top:1px;"><span title="Completamento risorsa">C:${resCompletion}%</span><span style="margin-left:4px;" title="Carico">L:${assignment.percentage}%</span></div>
                            ${getLocationBadgeHtml(assignment.task)}
                        `;
                    } else {
                        taskCard.innerHTML = `
                            <div style="font-size:11px;font-weight:bold;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(assignment.task.name)}">${escapeHtml(assignment.task.name)}${notesIndicator}${nightIndicator}</div>
                            <div style="font-size:10px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(assignment.project.client)}">${escapeHtml(assignment.project.client)}</div>
                            <div style="font-size:9px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(assignment.project.code)}">${escapeHtml(assignment.project.code)}${assignment.project.description ? ' - ' + escapeHtml(assignment.project.description) : ''}</div>
                            <div style="font-size:10px;margin-top:2px;"><span>Carico: ${assignment.percentage}%</span><span style="margin-left:8px;">Compl: ${resCompletion}%</span></div>
                            ${getLocationBadgeHtml(assignment.task)}
                        `;
                    }
                    taskCard.onclick = () => {
                        state.setCurrentProjectId(assignment.project.id);
                        if (typeof window.openTaskModal === 'function') window.openTaskModal(assignment.task.id);
                    };
                    dayCol.appendChild(taskCard);
                });

                // Suggerimenti attività flessibili
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const resourceLocation = getResourceLocationForDay(resource, dateStr);
                const locationFilteredTasks = filterFlexibleTasksByLocation(flexibleTasks, resourceLocation);
                const isNonWorkingDay = (isSat || isSun || isHol) && dayAssignments.length === 0;
                const showSuggestions = checkDate >= today && !isAbsent && !isNonWorkingDay &&
                    locationFilteredTasks.length > 0 &&
                    (dailyLoad < 100 || (resourceLocation.type === 'cliente' && resourceLocation.plantIds.length > 0));

                if (showSuggestions) {
                    if (dayAssignments.length > 0) {
                        const sep = document.createElement('div');
                        sep.style.cssText = 'border-top:1px dashed var(--info-color);margin:6px 0';
                        dayCol.appendChild(sep);
                    }
                    locationFilteredTasks.forEach(suggestion => {
                        const wouldOverlap = checkFlexibleTaskOverlap(colDate, suggestion.task, overload.dailyLoad, suggestion.percentage, endDate);

                        const suggCard = document.createElement('div');
                        suggCard.className    = 'week-task-card flexible-suggestion';
                        if (isMonthView)  suggCard.classList.add('month-view');
                        if (wouldOverlap) suggCard.classList.add('would-overlap');
                        if (!hasAssignedResources(suggestion.task)) suggCard.classList.add('unassigned-task');
                        suggCard.style.cursor = 'pointer';

                        const warningIcon = wouldOverlap ? '⚠️ ' : '💡 ';
                        const noteInd     = suggestion.task.notes && suggestion.task.notes.trim()
                            ? `<span style="color:var(--warning-color);margin-left:3px;cursor:help;" title="${escapeHtml(suggestion.task.notes).replace(/\n/g, '&#10;')}">📝</span>` : '';

                        if (isMonthView) {
                            suggCard.innerHTML = `
                                <div style="font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(suggestion.project.client)}">${warningIcon}${escapeHtml(suggestion.project.client)}</div>
                                <div style="font-size:8px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(suggestion.project.code)}</div>
                                <div style="font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(suggestion.task.name)}">${escapeHtml(suggestion.task.name)}${noteInd}</div>
                                <div style="font-size:8px;margin-top:1px;"><span title="Durata">D:${suggestion.task.duration}gg</span><span style="margin-left:4px;" title="Carico">L:${suggestion.percentage}%</span></div>
                                ${getLocationBadgeHtml(suggestion.task)}
                                ${wouldOverlap ? '<div style="font-size:7px;color:var(--danger-color);font-weight:bold;">⚠️</div>' : ''}
                                ${!hasAssignedResources(suggestion.task) ? '<div style="font-size:7px;color:var(--accent-color);font-weight:bold;">👤</div>' : ''}
                            `;
                        } else {
                            suggCard.innerHTML = `
                                <div style="font-size:11px;font-weight:bold;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(suggestion.task.name)}">${warningIcon}${escapeHtml(suggestion.task.name)}${noteInd}</div>
                                <div style="font-size:10px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(suggestion.project.client)}</div>
                                <div style="font-size:9px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(suggestion.project.code)}</div>
                                <div style="font-size:9px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px;">${escapeHtml(suggestion.project.description || '')}</div>
                                <div style="font-size:10px;margin-top:2px;"><span>Durata: ${suggestion.task.duration}gg</span> ${getLocationBadgeHtml(suggestion.task)}</div>
                                <div style="font-size:10px;"><span>Carico: ${suggestion.percentage}%</span></div>
                                ${wouldOverlap ? '<div style="font-size:9px;color:var(--danger-color);font-weight:bold;margin-top:2px;">⚠️ Sovrapposizione!</div>' : ''}
                                ${!hasAssignedResources(suggestion.task) ? '<div style="font-size:9px;color:var(--accent-color);font-weight:bold;margin-top:2px;">👤 Non assegnata</div>' : ''}
                            `;
                        }

                        const clickedDate = formatDateLocal(colDate);
                        suggCard.onclick = () => {
                            state.setSuggestedStartDate(clickedDate);
                            if (!hasAssignedResources(suggestion.task)) state.setSuggestedResourceId(resource.id);
                            state.setCurrentProjectId(suggestion.project.id);
                            if (typeof window.openTaskModal === 'function') window.openTaskModal(suggestion.task.id);
                        };
                        dayCol.appendChild(suggCard);
                    });
                }

                weekTimeline.appendChild(dayCol);
                colDate.setDate(colDate.getDate() + 1);
            }
            contentWrapper.appendChild(weekTimeline);
        }
    } else if (assignments.length > 0) {
        // Vista non a colonne: timeline lineare
        if (assignmentsInPeriod.length > 0) {
            const timeline = document.createElement('div');
            timeline.className = 'resource-timeline';

            assignmentsInPeriod.sort((a, b) => {
                if (a.type === 'meeting' && b.type !== 'meeting') return -1;
                if (a.type !== 'meeting' && b.type === 'meeting') return 1;
                return a.startDate.localeCompare(b.startDate);
            });

            assignmentsInPeriod.forEach(assignment => {
                const assignDiv   = document.createElement('div');
                assignDiv.className   = 'resource-assignment';
                assignDiv.style.cursor = 'pointer';

                if (assignment.type === 'meeting') {
                    const meeting = assignment.meeting;
                    assignDiv.classList.add('meeting-item');
                    const meetingInfo = document.createElement('div');
                    meetingInfo.style.cssText = 'font-size:13px;padding:8px 10px;display:grid;grid-template-columns:50px 200px 1fr 120px 120px;gap:15px;align-items:center;';
                    meetingInfo.innerHTML = `
                        <span style="font-size:24px;">🗓️</span>
                        <span style="font-weight:bold;color:white;">${escapeHtml(meeting.subject)}</span>
                        <span style="color:white;">${meeting.tags || ''}</span>
                        <span style="color:white;">Prev: ${meeting.expectedDuration ? meeting.expectedDuration + 'h' : '-'}</span>
                        <span style="color:white;">Reale: ${meeting.actualDuration ? meeting.actualDuration + 'h' : '-'}</span>
                    `;
                    assignDiv.appendChild(meetingInfo);
                    const dateRow = document.createElement('div');
                    dateRow.style.cssText = 'font-size:12px;padding:0 10px 8px 10px;color:white;';
                    dateRow.innerHTML = `<span>📅 ${meeting.date}${meeting.time ? ' ' + meeting.time : ''}</span>`;
                    assignDiv.appendChild(dateRow);
                    assignDiv.onclick = () => { if (typeof window.viewGlobalMeeting === 'function') window.viewGlobalMeeting(meeting.id); };
                    timeline.appendChild(assignDiv);
                    return;
                }

                // Task
                const status = assignment.task.status || 'nessuno';
                if (status === 'nessuno')    assignDiv.classList.add('status-none');
                if (status === 'completata') assignDiv.classList.add('status-completed');
                if (status === 'in-corso')   assignDiv.classList.add('status-in-progress');
                if (status === 'in-ritardo') assignDiv.classList.add('status-in-ritardo');
                if (status === 'pausa')      assignDiv.classList.add('status-paused');
                if (status === 'annullata')  assignDiv.classList.add('status-cancelled');
                if (assignment.isDelayExtended)  assignDiv.classList.add('delay-extended');
                if (assignment.task.nightWork)    assignDiv.classList.add('night-work');

                const hasConflict  = checkDateOverlap(assignment, assignmentsInPeriod);
                if (hasConflict) assignDiv.classList.add('conflict');

                const taskResources = assignment.task.resources || [];
                const hasAbsences   = hasAnyResourceAbsent(assignment.startDate, taskResources) ||
                                      hasAnyResourceAbsent(assignment.endDate,   taskResources);

                let absenceWarning = '';
                if (hasAbsences && assignment.task.status !== 'completata') {
                    const endWithoutAbsences = calculateEndDateForTask(
                        assignment.task.startDate,
                        assignment.task.duration,
                        assignment.task.saturdayWork,
                        assignment.task.sundayWork,
                        assignment.task.holidayWork || false,
                        null
                    );
                    if (endWithoutAbsences !== assignment.task.endDate) {
                        absenceWarning = `⚠️ Prolungata per assenze (prevista: ${endWithoutAbsences})`;
                    }
                }

                const notesIndicator = assignment.task.notes && assignment.task.notes.trim()
                    ? `<span style="color:var(--warning-color);margin-left:5px;cursor:help;" title="${escapeHtml(assignment.task.notes).replace(/\n/g, '&#10;')}">📝</span>` : '';
                const nightIndicator = assignment.task.nightWork
                    ? `<span style="margin-left:5px;cursor:help;" title="Notturno: ${assignment.task.nightWork}">🌙</span>` : '';

                const listResData       = assignment.task.resources && assignment.task.resources.find(r => r.resourceId == assignment.resourceId);
                const listResCompletion = listResData ? (listResData.completion || 0) : assignment.task.completion;

                const assignInfo = document.createElement('div');
                assignInfo.style.cssText = 'font-size:13px;padding:8px 10px;display:grid;grid-template-columns:200px 100px 1fr 120px 110px auto 150px;gap:15px;align-items:center;';
                assignInfo.innerHTML = `
                    <span style="font-weight:bold;color:var(--primary-color);">${escapeHtml(assignment.project.client)}</span>
                    <span>${escapeHtml(assignment.project.code)}</span>
                    <span style="font-weight:bold;">${escapeHtml(assignment.task.name)}${notesIndicator}${nightIndicator}</span>
                    <span>Compl: <strong>${listResCompletion}%</strong></span>
                    <span>Carico: <strong style="color:${assignment.percentage > 100 ? 'var(--danger-color)' : 'var(--primary-color)'};">${assignment.percentage}%</strong></span>
                    <span>${getLocationBadgeHtml(assignment.task)}</span>
                    <span style="color:var(--danger-color);font-weight:bold;">${hasConflict ? '⚠️ SOVRAPPOSIZIONE' : ''}</span>
                `;
                assignDiv.appendChild(assignInfo);

                const dateRow = document.createElement('div');
                dateRow.style.cssText = 'font-size:12px;padding:0 10px 8px 10px;color:var(--text-tertiary);display:flex;gap:20px;';
                dateRow.innerHTML = `
                    <span>📅 ${assignment.startDate} - ${assignment.endDate} (${assignment.task.duration} gg)</span>
                    <span style="color:var(--warning-color);font-weight:bold;">${absenceWarning}</span>
                `;
                assignDiv.appendChild(dateRow);

                assignDiv.onclick = () => {
                    state.setCurrentProjectId(assignment.project.id);
                    if (typeof window.openTaskModal === 'function') window.openTaskModal(assignment.task.id);
                };
                timeline.appendChild(assignDiv);
            });

            contentWrapper.appendChild(timeline);
        } else {
            const noAssign = document.createElement('div');
            noAssign.style.cssText = 'padding:10px;font-style:italic;color:var(--text-tertiary)';
            noAssign.textContent = 'Nessuna assegnazione nel periodo selezionato';
            contentWrapper.appendChild(noAssign);
        }
    } else {
        const noAssign = document.createElement('div');
        noAssign.style.cssText = 'padding:10px;font-style:italic;color:var(--text-tertiary)';
        noAssign.textContent   = 'Nessuna assegnazione nel periodo selezionato';
        contentWrapper.appendChild(noAssign);
    }

    // ── Suggerimenti per viste NON a colonne ─────────────────────────────────
    if (!isColumnView) {
        let nonColCheckDate;
        if (period === 'day') {
            const dayValue = document.getElementById('resourceViewSpecificDay')?.value;
            nonColCheckDate = dayValue ? new Date(dayValue) : new Date();
        } else {
            nonColCheckDate = new Date();
        }
        nonColCheckDate.setHours(0, 0, 0, 0);
        const nonColDateStr      = formatDateLocal(nonColCheckDate);
        const resourceLocationNc = getResourceLocationForDay(resource, nonColDateStr);

        if (overload.maxLoad < 100 || (resourceLocationNc.type === 'cliente' && resourceLocationNc.plantIds.length > 0)) {
            const isAbsentOnDate = resource.absences && resource.absences.some(absence => {
                const absStart = new Date(absence.start); absStart.setHours(0, 0, 0, 0);
                const absEnd   = new Date(absence.end);   absEnd.setHours(23, 59, 59, 999);
                return nonColCheckDate >= absStart && nonColCheckDate <= absEnd;
            });
            const dow             = nonColCheckDate.getDay();
            const isHoliday       = state.holidays.some(h => h.date === nonColDateStr);
            const hideSuggestions = document.getElementById('resourceViewHideSuggestions')?.checked || false;
            const isNonWorkingNc  = (dow === 6 || dow === 0 || isHoliday) && !resourceLocationNc.hasWork;
            const shouldShow      = !hideSuggestions && !isAbsentOnDate && !isNonWorkingNc;

            const flexibleTasksNc = [];
            if (shouldShow) {
                state.projects.forEach(project => {
                    if (!project.tasks) return;
                    project.tasks.forEach(task => {
                        if (!task.flexibleDate || task.completion !== 0 || task.status === 'pausa' || task.status === 'annullata') return;
                        if (hasAssignedResources(task)) {
                            const res           = task.resources.find(r => r.resourceId == resource.id);
                            const resCompletion = res ? (parseInt(res.completion, 10) || 0) : 0;
                            if (res && resCompletion < 100) flexibleTasksNc.push({ project, task, percentage: res.percentage });
                        } else {
                            flexibleTasksNc.push({ project, task, percentage: 100 });
                        }
                    });
                });
            }

            const locationFilteredNc = filterFlexibleTasksByLocation(flexibleTasksNc, resourceLocationNc);
            if (locationFilteredNc.length > 0) {
                const suggestionsDiv = document.createElement('div');
                suggestionsDiv.className   = 'resource-suggestions';
                suggestionsDiv.innerHTML   = '<div style="font-weight:bold;margin-bottom:8px;color:var(--info-color);">💡 Attività Proposte (Data Flessibile):</div>';

                locationFilteredNc.forEach(suggestion => {
                    const suggCard = document.createElement('div');
                    suggCard.className     = 'resource-assignment flexible-suggestion';
                    if (!hasAssignedResources(suggestion.task)) suggCard.classList.add('unassigned-task');
                    suggCard.style.cursor  = 'pointer';
                    suggCard.style.backgroundColor = 'var(--bg-tertiary)';
                    suggCard.style.border  = '2px dashed var(--info-color)';

                    const unassignedBadge = !hasAssignedResources(suggestion.task)
                        ? '<span style="color:var(--accent-color);font-weight:bold;margin-left:10px;">👤 Non assegnata</span>' : '';
                    const noteInd = suggestion.task.notes && suggestion.task.notes.trim()
                        ? `<span style="color:var(--warning-color);margin-left:5px;cursor:help;" title="${escapeHtml(suggestion.task.notes).replace(/\n/g, '&#10;')}">📝</span>` : '';

                    const suggInfo = document.createElement('div');
                    suggInfo.style.cssText = 'font-size:13px;padding:8px 10px;display:grid;grid-template-columns:200px 100px 1fr 120px 110px auto;gap:15px;align-items:center;';
                    suggInfo.innerHTML = `
                        <span style="font-weight:bold;color:var(--info-color);">${escapeHtml(suggestion.project.client)}</span>
                        <span style="color:var(--text-secondary);">${escapeHtml(suggestion.project.code)}</span>
                        <span style="font-weight:bold;">${escapeHtml(suggestion.task.name)}${noteInd}${unassignedBadge}<br><span style="font-size:11px;color:var(--text-tertiary);font-weight:normal;">${escapeHtml(suggestion.project.description || '')}</span></span>
                        <span>Durata: <strong>${suggestion.task.duration} gg</strong></span>
                        <span>Carico: <strong>${suggestion.percentage}%</strong></span>
                        <span>${getLocationBadgeHtml(suggestion.task)}</span>
                    `;
                    suggCard.appendChild(suggInfo);

                    suggCard.onclick = () => {
                        state.setSuggestedStartDate(formatDateLocal(new Date()));
                        if (!hasAssignedResources(suggestion.task)) state.setSuggestedResourceId(resource.id);
                        state.setCurrentProjectId(suggestion.project.id);
                        if (typeof window.openTaskModal === 'function') window.openTaskModal(suggestion.task.id);
                    };
                    suggestionsDiv.appendChild(suggCard);
                });
                contentWrapper.appendChild(suggestionsDiv);
            }
        }
    }

    card.appendChild(contentWrapper);
    return card;
}

// ─── Helpers privati: calcoli ─────────────────────────────────────────────────

function calculateResourceOverload(assignments, periodStart, periodEnd) {
    const dailyLoad = {};
    const todayStr  = formatDateLocal(new Date());

    assignments.forEach(assignment => {
        const { task } = assignment;
        if (task.completion >= 100 || task.status === 'completata' || task.status === 'pausa' || task.status === 'annullata') return;

        const start = new Date(assignment.startDate); start.setHours(0, 0, 0, 0);
        let endDateStr = assignment.endDate;

        if (task.status === 'in-ritardo' && task.completion < 100 && endDateStr < todayStr) {
            const resData = task.resources && task.resources.find(r => r.resourceId == assignment.resourceId);
            if (!resData || (resData.completion || 0) < 100) endDateStr = todayStr;
        }

        const end       = new Date(endDateStr); end.setHours(0, 0, 0, 0);
        const calcStart = start < periodStart ? new Date(periodStart) : new Date(start);
        const calcEnd   = end   > periodEnd   ? new Date(periodEnd)   : new Date(end);

        const cur = new Date(calcStart);
        while (cur <= calcEnd) {
            if (isWorkingDay(cur, task)) {
                const ds = formatDateLocal(cur);
                if (!dailyLoad[ds]) dailyLoad[ds] = 0;
                dailyLoad[ds] += assignment.percentage;
            }
            cur.setDate(cur.getDate() + 1);
        }
    });

    const maxLoad = Math.max(...Object.values(dailyLoad), 0);
    return { maxLoad, dailyLoad };
}

function isWorkingDay(date, task) {
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 6 && !task.saturdayWork) return false;
    if (dayOfWeek === 0 && !task.sundayWork)   return false;
    if (!task.holidayWork) {
        const dateStr   = formatDateLocal(date);
        if (state.holidays.some(h => h.date === dateStr)) return false;
    }
    const dateStr       = formatDateLocal(date);
    const taskResources = task.resources || [];
    if (areAllResourcesAbsent(dateStr, taskResources)) return false;
    return true;
}

function getColorForLoad(percentage) {
    if (percentage <= 50) {
        const ratio = percentage / 50;
        return `rgb(${Math.floor(66 + (144 - 66) * ratio)}, ${Math.floor(165 + (186 - 165) * ratio)}, ${Math.floor(245 + (228 - 245) * ratio)})`;
    } else if (percentage <= 100) {
        const ratio = (percentage - 50) / 50;
        return `rgb(${Math.floor(144 - (144 - 102) * ratio)}, ${Math.floor(186 + (156 - 186) * ratio)}, ${Math.floor(228 - (228 - 122) * ratio)})`;
    } else {
        const ratio = Math.min((percentage - 100) / 100, 1);
        return `rgb(${Math.floor(102 + (244 - 102) * ratio)}, ${Math.floor(156 - (156 - 67) * ratio)}, ${Math.floor(122 - (122 - 54) * ratio)})`;
    }
}

function checkFlexibleTaskOverlap(startDate, task, dailyLoadMap, taskPercentage, periodEnd) {
    const duration    = task.duration || 1;
    let daysProcessed = 0;
    let cur           = new Date(startDate);

    while (daysProcessed < duration && cur <= periodEnd) {
        const dateStr   = formatDateLocal(cur);
        const currentLoad = dailyLoadMap[dateStr] || 0;
        const dow       = cur.getDay();
        const isHoliday = state.holidays.some(h => h.date === dateStr);

        let isWorkDay = true;
        if (dow === 6 && !task.saturdayWork)  isWorkDay = false;
        if (dow === 0 && !task.sundayWork)    isWorkDay = false;
        if (isHoliday && !task.holidayWork)   isWorkDay = false;

        if (isWorkDay) {
            if (currentLoad + taskPercentage > 100) return true;
            daysProcessed++;
        }
        cur.setDate(cur.getDate() + 1);
    }
    return false;
}

function checkDateOverlap(assignment, allAssignments) {
    const start1 = new Date(assignment.startDate);
    const end1   = new Date(assignment.endDate);
    return allAssignments.some(other => {
        if (other === assignment) return false;
        const start2 = new Date(other.startDate);
        const end2   = new Date(other.endDate);
        return start1 <= end2 && end1 >= start2;
    });
}

function getResourceLocationForDay(resource, dateStr) {
    const plantIds    = new Set();
    let hasClientTask = false;
    let hasAnyTask    = false;

    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (!task.startDate || !task.endDate) return;
            if (['annullata','completata','pausa'].includes(task.status)) return;
            if (!task.resources) return;

            const res = task.resources.find(r => r.resourceId == resource.id);
            if (!res) return;

            const taskStart = new Date(task.startDate); taskStart.setHours(0, 0, 0, 0);
            const taskEnd   = new Date(task.endDate);   taskEnd.setHours(23, 59, 59, 999);
            const checkDate = new Date(dateStr);        checkDate.setHours(12, 0, 0, 0);

            if (checkDate >= taskStart && checkDate <= taskEnd) {
                if (isWorkingDay(checkDate, task)) {
                    hasAnyTask = true;
                    if (task.locationType === 'cliente') {
                        hasClientTask = true;
                        if (task.plantId) plantIds.add(Number(task.plantId));
                    }
                }
            }
        });
    });

    if (hasClientTask) return { type: 'cliente', plantIds: [...plantIds], hasWork: true };
    return { type: 'sede', plantIds: [], hasWork: hasAnyTask };
}

function filterFlexibleTasksByLocation(flexibleTasks, resourceLocation) {
    return flexibleTasks.filter(suggestion => {
        const taskLocation = suggestion.task.locationType || 'sede';
        if (resourceLocation.type === 'cliente' && resourceLocation.plantIds.length > 0) {
            if (taskLocation === 'cliente' && suggestion.task.plantId) {
                return resourceLocation.plantIds.includes(Number(suggestion.task.plantId));
            }
            return false;
        }
        return taskLocation === 'sede' || taskLocation === 'remoto';
    });
}
