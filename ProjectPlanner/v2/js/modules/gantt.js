/**
 * js/modules/gantt.js
 *
 * Rendering del Gantt Chart (tab "Gantt"): vista per progetto e per risorsa,
 * navigazione temporale, zoom, collapse/expand righe.
 *
 * Dipendenze v2:
 *   - ../state.js    → resources, projects, holidays, currentProjectId,
 *                      setCurrentProjectId, collapsedResources
 *   - ../helpers.js  → formatDateLocal, escapeHtml, getResourceName,
 *                      parseDateLocal, hoursToHHMM, getLocationBadgeHtml,
 *                      areAllResourcesAbsent
 *
 * Funzioni esposte su window da app.js:
 *   window.renderGantt              = Gantt.renderGantt
 *   window.updateGanttFilters       = Gantt.updateGanttFilters
 *   window.ganttPrev                = Gantt.ganttPrev
 *   window.ganttNext                = Gantt.ganttNext
 *   window.ganttToday               = Gantt.ganttToday
 *   window.collapseAllGanttProjects = Gantt.collapseAllGanttProjects
 *   window.expandAllGanttProjects   = Gantt.expandAllGanttProjects
 *   window.toggleGanttCompactMode   = Gantt.toggleGanttCompactMode
 */

import * as state from '../state.js';
import {
    formatDateLocal,
    escapeHtml,
    getResourceName,
    parseDateLocal,
    hoursToHHMM,
    getLocationBadgeHtml,
    areAllResourcesAbsent
} from '../helpers.js';

// ─── Stato locale ─────────────────────────────────────────────────────────────

/** Offset in giorni rispetto ad oggi per navigazione prev/next (0 = oggi) */
let _ganttDayOffset = 0;

// ─── Navigazione ──────────────────────────────────────────────────────────────

export function ganttPrev() {
    const period = document.getElementById('ganttPeriodFilter')?.value || 'month';
    const daysMap = { week: 7, month: 30, quarter: 90, year: 365 };
    _ganttDayOffset -= (daysMap[period] || 30);
    renderGantt();
}

export function ganttNext() {
    const period = document.getElementById('ganttPeriodFilter')?.value || 'month';
    const daysMap = { week: 7, month: 30, quarter: 90, year: 365 };
    _ganttDayOffset += (daysMap[period] || 30);
    renderGantt();
}

export function ganttToday() {
    _ganttDayOffset = 0;
    renderGantt();
}

// ─── Filtri ───────────────────────────────────────────────────────────────────

export function updateGanttFilters() {
    const projectSelect = document.getElementById('ganttProjectFilter');
    if (projectSelect) {
        const currentValue = projectSelect.value;
        projectSelect.innerHTML = '<option value="">Tutti i Progetti</option>';
        state.projects.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = `${p.client} - ${p.code}`;
            if (p.id == currentValue) option.selected = true;
            projectSelect.appendChild(option);
        });
    }
}

// ─── Rendering principale ─────────────────────────────────────────────────────

export function renderGantt() {
    const projectFilter = document.getElementById('ganttProjectFilter')?.value;
    const periodFilter  = document.getElementById('ganttPeriodFilter')?.value || 'month';
    const viewFilter    = document.getElementById('ganttViewFilter')?.value || 'projects';
    const container     = document.getElementById('ganttChart');

    if (!container) return;

    // Rimuovi barra riepilogativa precedente se presente
    const oldSummary = container.parentElement?.querySelector('.gantt-summary-bar');
    if (oldSummary) oldSummary.remove();

    container.innerHTML = '';

    // Calcola "oggi" con eventuale offset di navigazione
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (_ganttDayOffset !== 0) {
        today.setDate(today.getDate() + _ganttDayOffset);
    }

    // Trova il range di date da tutti i progetti
    let minDate = null;
    let maxDate = null;

    const filteredProjects = projectFilter
        ? state.projects.filter(p => p.id == projectFilter)
        : state.projects;

    filteredProjects.forEach(project => {
        if (project.milestones) {
            project.milestones.forEach(m => {
                if (m.date) {
                    const date = new Date(m.date);
                    if (!minDate || date < minDate) minDate = date;
                    if (!maxDate || date > maxDate) maxDate = date;
                }
            });
        }
        if (project.tasks) {
            project.tasks.forEach(t => {
                if (t.startDate) {
                    const date = new Date(t.startDate);
                    if (!minDate || date < minDate) minDate = date;
                }
                if (t.endDate) {
                    const date = new Date(t.endDate);
                    if (!maxDate || date > maxDate) maxDate = date;
                }
            });
        }
    });

    if (!minDate || !maxDate) {
        container.innerHTML = '<p style="padding: 20px; text-align: center;">Nessun dato da visualizzare. Aggiungi progetti con milestone o attività.</p>';
        return;
    }

    // Applica filtro periodo
    switch (periodFilter) {
        case 'week': {
            minDate = new Date(today);
            const dayOfWeek = minDate.getDay();
            const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            minDate.setDate(minDate.getDate() + diff);
            maxDate = new Date(minDate);
            maxDate.setDate(maxDate.getDate() + 6);
            break;
        }
        case 'month':
            minDate = new Date(today.getFullYear(), today.getMonth(), 1);
            maxDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            break;
        case 'quarter':
            minDate = new Date(today.getFullYear(), today.getMonth(), 1);
            maxDate = new Date(today.getFullYear(), today.getMonth() + 3, 0);
            break;
        case 'year':
            minDate = new Date(today.getFullYear(), 0, 1);
            maxDate = new Date(today.getFullYear(), 11, 31);
            break;
        case 'all':
            // mantieni i valori calcolati dai progetti
            break;
    }

    // Genera array di tutti i giorni nel range
    const days = [];
    const currentDate = new Date(minDate);
    while (currentDate <= maxDate) {
        days.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // ── Header timeline ──────────────────────────────────────────────────────
    const timeline = document.createElement('div');
    timeline.className = 'gantt-timeline';

    // Riga Anno
    const yearRow = document.createElement('div');
    yearRow.className = 'gantt-timeline-row';
    const yearLabelCell = document.createElement('div');
    yearLabelCell.className = 'gantt-timeline-label';
    yearLabelCell.textContent = 'Anno';
    yearRow.appendChild(yearLabelCell);

    let currentYear = null;
    let yearSpanStart = 0;
    days.forEach((day, index) => {
        const year = day.getFullYear();
        if (year !== currentYear) {
            if (currentYear !== null) {
                const item = document.createElement('div');
                item.className = 'gantt-timeline-item year-header merged';
                item.textContent = currentYear;
                const spanDays = index - yearSpanStart;
                item.style.width = `calc(${spanDays} * var(--gantt-day-width))`;
                item.style.minWidth = item.style.width;
                yearRow.appendChild(item);
            }
            currentYear = year;
            yearSpanStart = index;
        }
    });
    if (currentYear !== null) {
        const item = document.createElement('div');
        item.className = 'gantt-timeline-item year-header merged';
        item.textContent = currentYear;
        const spanDays = days.length - yearSpanStart;
        item.style.width = `calc(${spanDays} * var(--gantt-day-width))`;
        item.style.minWidth = item.style.width;
        yearRow.appendChild(item);
    }
    timeline.appendChild(yearRow);

    // Riga Mese
    const monthRow = document.createElement('div');
    monthRow.className = 'gantt-timeline-row';
    const monthLabelCell = document.createElement('div');
    monthLabelCell.className = 'gantt-timeline-label';
    monthLabelCell.textContent = 'Mese';
    monthRow.appendChild(monthLabelCell);

    const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                        'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    let currentMonth = null;
    let monthSpanStart = 0;
    days.forEach((day, index) => {
        const monthKey = `${day.getFullYear()}-${day.getMonth()}`;
        if (monthKey !== currentMonth) {
            if (currentMonth !== null) {
                const prevMonthIndex = parseInt(currentMonth.split('-')[1]);
                const item = document.createElement('div');
                item.className = 'gantt-timeline-item month-header merged';
                item.textContent = monthNames[prevMonthIndex];
                const spanDays = index - monthSpanStart;
                item.style.width = `calc(${spanDays} * var(--gantt-day-width))`;
                item.style.minWidth = item.style.width;
                monthRow.appendChild(item);
            }
            currentMonth = monthKey;
            monthSpanStart = index;
        }
    });
    if (currentMonth !== null) {
        const lastMonthIndex = parseInt(currentMonth.split('-')[1]);
        const item = document.createElement('div');
        item.className = 'gantt-timeline-item month-header merged';
        item.textContent = monthNames[lastMonthIndex];
        const spanDays = days.length - monthSpanStart;
        item.style.width = `calc(${spanDays} * var(--gantt-day-width))`;
        item.style.minWidth = item.style.width;
        monthRow.appendChild(item);
    }
    timeline.appendChild(monthRow);

    // Riga Settimana
    const weekRow = document.createElement('div');
    weekRow.className = 'gantt-timeline-row';
    const weekLabelCell = document.createElement('div');
    weekLabelCell.className = 'gantt-timeline-label';
    weekLabelCell.textContent = 'Sett';
    weekRow.appendChild(weekLabelCell);

    let currentWeek = null;
    let weekSpanStart = 0;
    days.forEach((day, index) => {
        const weekNum = getWeekNumber(day);
        if (weekNum !== currentWeek) {
            if (currentWeek !== null) {
                const item = document.createElement('div');
                item.className = 'gantt-timeline-item week-header merged';
                item.classList.add(currentWeek % 2 === 0 ? 'week-even' : 'week-odd');
                item.textContent = `S${currentWeek}`;
                const spanDays = index - weekSpanStart;
                item.style.width = `calc(${spanDays} * var(--gantt-day-width))`;
                item.style.minWidth = item.style.width;
                weekRow.appendChild(item);
            }
            currentWeek = weekNum;
            weekSpanStart = index;
        }
    });
    if (currentWeek !== null) {
        const item = document.createElement('div');
        item.className = 'gantt-timeline-item week-header merged';
        item.classList.add(currentWeek % 2 === 0 ? 'week-even' : 'week-odd');
        item.textContent = `S${currentWeek}`;
        const spanDays = days.length - weekSpanStart;
        item.style.width = `calc(${spanDays} * var(--gantt-day-width))`;
        item.style.minWidth = item.style.width;
        weekRow.appendChild(item);
    }
    timeline.appendChild(weekRow);

    // Riga Giorno
    const dayRow = document.createElement('div');
    dayRow.className = 'gantt-timeline-row';
    const dayLabelCell = document.createElement('div');
    dayLabelCell.className = 'gantt-timeline-label';
    dayLabelCell.textContent = 'Progetto';
    dayRow.appendChild(dayLabelCell);

    const realToday = new Date();
    realToday.setHours(0, 0, 0, 0);
    days.forEach(day => {
        const item = document.createElement('div');
        item.className = 'gantt-timeline-item';
        item.textContent = day.getDate();
        const checkDay = new Date(day);
        checkDay.setHours(0, 0, 0, 0);
        if (checkDay.getTime() === realToday.getTime()) {
            item.classList.add('today');
        }
        dayRow.appendChild(item);
    });
    timeline.appendChild(dayRow);

    container.appendChild(timeline);

    // Calcola e imposta zoom automatico
    const totalDays = days.length;
    const containerWidth = container.clientWidth - 250;
    const defaultDayWidth = Math.max(15, Math.min(80, Math.floor(containerWidth / totalDays)));
    document.documentElement.style.setProperty('--gantt-day-width', `${defaultDayWidth}px`);
    if (defaultDayWidth < 30) {
        container.classList.add('zoomed-out');
    } else {
        container.classList.remove('zoomed-out');
    }

    // Abilita interazioni (scroll, zoom)
    setupGanttInteractions(container);

    // Renderizza contenuto in base alla vista selezionata
    if (viewFilter === 'projects') {
        renderGanttByProjects(container, filteredProjects, days, minDate, maxDate);
    } else {
        renderGanttByResources(container, filteredProjects, days, minDate, maxDate);
    }

    // Linea verticale "Oggi"
    const todayIndex = days.findIndex(d => {
        const dd = new Date(d);
        dd.setHours(0, 0, 0, 0);
        return dd.getTime() === realToday.getTime();
    });
    if (todayIndex >= 0) {
        const dayWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gantt-day-width'));
        const todayLine = document.createElement('div');
        todayLine.className = 'gantt-today-line';
        todayLine.style.left = `${250 + todayIndex * dayWidth}px`;
        todayLine._todayIndex = todayIndex;
        container.style.position = 'relative';
        container.appendChild(todayLine);
    }

    // Modalità compatta
    if (document.getElementById('ganttCompactMode')?.checked) {
        container.classList.add('compact-mode');
    }
}

// ─── Vista per Progetto ───────────────────────────────────────────────────────

export function renderGanttByProjects(container, filteredProjects, days, minDate, maxDate) {
    const hideCompleted   = document.getElementById('ganttHideCompleted')?.checked || false;
    const hideOutOfPeriod = document.getElementById('ganttHideOutOfPeriod')?.checked || false;

    filteredProjects.forEach(project => {
        // Verifica se ci sono attività visibili
        let hasVisibleTasks = false;
        if (project.tasks && project.tasks.length > 0) {
            hasVisibleTasks = project.tasks.some(task => {
                if (!task.startDate || !task.endDate) return false;
                if (hideCompleted && task.completion === 100) return false;
                if (hideOutOfPeriod) {
                    const taskStart = new Date(task.startDate);
                    const taskEnd   = new Date(getEffectiveEndDate(task));
                    if (taskEnd < minDate || taskStart > maxDate) return false;
                }
                return true;
            });
        }
        if (!hasVisibleTasks) return;

        // Badge flag lavoro weekend/festivo
        const workFlags = [];
        if (project.tasks) {
            if (project.tasks.some(t => t.saturdayWork)) workFlags.push('📅Sab');
            if (project.tasks.some(t => t.sundayWork))   workFlags.push('📅Dom');
            if (project.tasks.some(t => t.holidayWork))  workFlags.push('🎉Fest');
        }
        const workFlagsStr = workFlags.length > 0 ? ` [${workFlags.join(' ')}]` : '';

        // Riga progetto
        const projectRow = createGanttRow(`📁 ${project.client} - ${project.code}${workFlagsStr}`, days, 'project', project.id);

        // Badge riepilogativo stato task
        if (project.tasks && project.tasks.length > 0) {
            const visibleTasks = project.tasks.filter(t => t.startDate && t.endDate);
            const counts = { completed: 0, inCorso: 0, inRitardo: 0, pausa: 0, none: 0 };
            visibleTasks.forEach(t => {
                if (t.status === 'completata' || t.completion === 100) counts.completed++;
                else if (t.status === 'in-ritardo') counts.inRitardo++;
                else if (t.status === 'pausa')      counts.pausa++;
                else if (t.status === 'in-corso')   counts.inCorso++;
                else counts.none++;
            });
            if (visibleTasks.length > 0) {
                const badge = document.createElement('span');
                badge.className = 'project-summary-badge';
                const items = [];
                if (counts.completed > 0) items.push(`<span class="ps-item ps-completed">✓${counts.completed}</span>`);
                if (counts.inCorso   > 0) items.push(`<span class="ps-item ps-in-corso">▶${counts.inCorso}</span>`);
                if (counts.inRitardo > 0) items.push(`<span class="ps-item ps-in-ritardo">⚠${counts.inRitardo}</span>`);
                if (counts.pausa     > 0) items.push(`<span class="ps-item ps-pausa">⏸${counts.pausa}</span>`);
                if (counts.none      > 0) items.push(`<span class="ps-item ps-none">○${counts.none}</span>`);
                badge.innerHTML = items.join('');
                projectRow.querySelector('.gantt-row-label').appendChild(badge);
            }
        }

        container.appendChild(projectRow);

        // Barra progetto (min-max date da tasks+milestones)
        const stats = calculateProjectStats(project);
        if (stats.startDate && stats.endDate) {
            const projectWorkSettings = {
                saturdayWork: project.tasks && project.tasks.some(t => t.saturdayWork),
                sundayWork:   project.tasks && project.tasks.some(t => t.sundayWork),
                holidayWork:  project.tasks && project.tasks.some(t => t.holidayWork)
            };
            addGanttBar(projectRow, stats.startDate, stats.endDate, project.client, days, minDate, 'project', null, projectWorkSettings);
        }

        // Milestone
        if (project.milestones && project.milestones.length > 0) {
            const milestoneRow = createGanttRow(`  ◆ Milestone (${project.milestones.length})`, days, 'milestone', project.id);
            container.appendChild(milestoneRow);
            project.milestones.forEach(milestone => {
                addGanttBar(milestoneRow, milestone.date, milestone.date, milestone.name, days, minDate, 'milestone', null, null);
            });
        }

        // Tasks
        if (project.tasks && project.tasks.length > 0) {
            project.tasks.forEach(task => {
                if (!task.startDate || !task.endDate) return;
                if (hideCompleted && task.completion === 100) return;
                if (hideOutOfPeriod) {
                    const taskStart = new Date(task.startDate);
                    const taskEnd   = new Date(getEffectiveEndDate(task));
                    if (taskEnd < minDate || taskStart > maxDate) return;
                }

                const taskRow = createGanttRow(`  ▪ ${task.name}`, days, 'task', project.id);
                container.appendChild(taskRow);

                let barClass = 'task';
                if (task.status === 'nessuno')     barClass += ' status-none';
                if (task.status === 'completata')  barClass += ' status-completed';
                if (task.status === 'in-ritardo')  barClass += ' status-in-ritardo';
                if (task.status === 'pausa')       barClass += ' status-paused';
                if (task.status === 'annullata')   barClass += ' status-cancelled';
                if (!task.resources || task.resources.length === 0) barClass += ' not-assigned';

                addGanttBar(taskRow, task.startDate, task.endDate, task.name, days, minDate, barClass, () => {
                    state.setCurrentProjectId(project.id);
                    if (typeof window.openTaskModal === 'function') window.openTaskModal(task.id);
                }, task);

                // Estensione tratteggiata per task in ritardo
                const effectiveEnd = getEffectiveEndDate(task);
                if (effectiveEnd > task.endDate) {
                    const nextDay = new Date(task.endDate);
                    nextDay.setDate(nextDay.getDate() + 1);
                    addGanttBar(taskRow, formatDateLocal(nextDay), effectiveEnd, '', days, minDate, 'task delay-extension', () => {
                        state.setCurrentProjectId(project.id);
                        if (typeof window.openTaskModal === 'function') window.openTaskModal(task.id);
                    }, task);
                }
            });
        }
    });
}

// ─── Vista per Risorsa ────────────────────────────────────────────────────────

export function renderGanttByResources(container, filteredProjects, days, minDate, maxDate) {
    const resourceTasks   = {};
    const hideCompleted   = document.getElementById('ganttHideCompleted')?.checked || false;
    const hideOutOfPeriod = document.getElementById('ganttHideOutOfPeriod')?.checked || false;

    // Raggruppa task per risorsa poi per progetto
    filteredProjects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (hideCompleted && task.completion === 100) return;
            if (hideOutOfPeriod && task.startDate && task.endDate) {
                const taskStart = new Date(task.startDate);
                const taskEnd   = new Date(getEffectiveEndDate(task));
                if (taskEnd < minDate || taskStart > maxDate) return;
            }
            if (!task.resources || !task.startDate || !task.endDate) return;

            task.resources.forEach(res => {
                const resource = state.resources.find(r => r.id == res.resourceId);
                if (!resource) return;

                if (!resourceTasks[resource.id]) {
                    resourceTasks[resource.id] = { resource, projectGroups: {} };
                }
                if (!resourceTasks[resource.id].projectGroups[project.id]) {
                    resourceTasks[resource.id].projectGroups[project.id] = { project, tasks: [] };
                }
                resourceTasks[resource.id].projectGroups[project.id].tasks.push({
                    ...task, project, percentage: res.percentage
                });
            });
        });
    });

    // Palette colori per distinguere progetti
    const projectColorPalette = [
        '#5b8db8','#6b9c7b','#d4b95f','#c9885f','#9b7db8',
        '#5bb8a9','#b85b7d','#7db85b','#b8955b','#5b6fb8',
        '#b85ba9','#5bb87d','#b8b35b','#5b9eb8','#b86b5b','#8b5bb8'
    ];
    const projectColorMap = {};
    let colorIndex = 0;
    Object.values(resourceTasks).forEach(rd => {
        Object.values(rd.projectGroups).forEach(pg => {
            if (!projectColorMap[pg.project.id]) {
                projectColorMap[pg.project.id] = projectColorPalette[colorIndex % projectColorPalette.length];
                colorIndex++;
            }
        });
    });

    // Statistiche per barra riepilogativa
    const todayStr = formatDateLocal(new Date());
    let totalResourcesShown = 0;
    let resourcesOverloaded = 0;
    let resourcesOnAbsence  = 0;

    state.resources.filter(r => !r.hidden).forEach(resource => {
        const resourceData = resourceTasks[resource.id];
        if (!resourceData) return;
        totalResourcesShown++;

        const allT = Object.values(resourceData.projectGroups).flatMap(pg => pg.tasks);
        const asgn = allT.map(task => ({
            task, percentage: task.percentage, resourceId: resource.id,
            startDate: task.startDate,
            endDate: getEffectiveEndDateForResource(task, resource.id)
        }));
        const ov = calculateResourceOverload(asgn, minDate, maxDate);
        if ((ov.dailyLoad[todayStr] || 0) > 100) resourcesOverloaded++;

        if (resource.absences && resource.absences.length > 0) {
            const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
            const isAbsent = resource.absences.some(a => {
                const s = new Date(a.start); s.setHours(0, 0, 0, 0);
                const e = new Date(a.end);   e.setHours(0, 0, 0, 0);
                return todayDate >= s && todayDate <= e;
            });
            if (isAbsent) resourcesOnAbsence++;
        }
    });

    if (totalResourcesShown > 0) {
        const summaryBar = document.createElement('div');
        summaryBar.className = 'gantt-summary-bar';
        summaryBar.innerHTML = `
            <div class="gs-item">👥 Risorse: <span class="gs-value">${totalResourcesShown}</span></div>
            <div class="gs-item">🔴 Sovraccariche: <span class="gs-value" style="color: ${resourcesOverloaded > 0 ? '#d32f2f' : 'inherit'}">${resourcesOverloaded}</span></div>
            <div class="gs-item">🏖️ In assenza: <span class="gs-value" style="color: ${resourcesOnAbsence > 0 ? '#e65100' : 'inherit'}">${resourcesOnAbsence}</span></div>
        `;
        container.parentElement.insertBefore(summaryBar, container);
    }

    // Renderizza per risorsa (ordine dell'array resources)
    state.resources.filter(r => !r.hidden).forEach(resource => {
        const resourceData = resourceTasks[resource.id];
        if (!resourceData) return;

        const { projectGroups } = resourceData;
        const allTasks = Object.values(projectGroups).flatMap(pg => pg.tasks);

        // Riga risorsa con barra di carico
        const resourceRow = createGanttRow(`👤 ${resource.firstName} ${resource.lastName}`, days, 'resource', null, resource.id);
        resourceRow.dataset.resourceId = resource.id;
        resourceRow.style.minHeight = '50px';
        resourceRow.style.height    = '50px';

        // Icona expand/collapse
        const labelDiv  = resourceRow.querySelector('.gantt-row-label');
        const expandIcon = document.createElement('span');
        expandIcon.className = 'gantt-expand-icon';
        expandIcon.textContent = '▼';
        expandIcon.onclick = e => { e.stopPropagation(); toggleGanttResource(resource.id); };
        labelDiv.insertBefore(expandIcon, labelDiv.firstChild);

        // Status badge (assenza corrente o carico oggi)
        const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
        let currentAbsenceType = null;
        if (resource.absences) {
            resource.absences.forEach(absence => {
                const absStart = new Date(absence.start); absStart.setHours(0, 0, 0, 0);
                const absEnd   = new Date(absence.end);   absEnd.setHours(0, 0, 0, 0);
                if (todayDate >= absStart && todayDate <= absEnd) currentAbsenceType = absence.type;
            });
        }

        const assignments = allTasks.map(task => ({
            task, percentage: task.percentage, resourceId: resource.id,
            startDate: task.startDate,
            endDate: getEffectiveEndDateForResource(task, resource.id)
        }));
        const overload  = calculateResourceOverload(assignments, minDate, maxDate);
        const todayLoad = overload.dailyLoad[todayStr] || 0;

        const statusBadge = document.createElement('span');
        statusBadge.className = 'resource-status-badge';
        if (currentAbsenceType) {
            const absLabels = { vacation: '🏖️ In ferie', sick: '🤒 Malattia', planned_intervention: '🏥 Intervento' };
            statusBadge.textContent = absLabels[currentAbsenceType] || '🏖️ Assente';
            statusBadge.classList.add('status-absence');
        } else if (todayLoad === 0) {
            statusBadge.textContent = '⚪ Disponibile';
            statusBadge.classList.add('status-available');
        } else if (todayLoad <= 80) {
            statusBadge.textContent = `🟢 ${todayLoad.toFixed(0)}%`;
            statusBadge.classList.add('status-light');
        } else if (todayLoad <= 100) {
            statusBadge.textContent = `🟡 ${todayLoad.toFixed(0)}%`;
            statusBadge.classList.add('status-busy');
        } else {
            statusBadge.textContent = `🔴 ${todayLoad.toFixed(0)}%`;
            statusBadge.classList.add('status-overloaded');
        }
        labelDiv.appendChild(statusBadge);

        const activeProjects = Object.keys(projectGroups).length;
        const activeTasks    = allTasks.filter(t => t.status !== 'completata' && t.status !== 'annullata').length;
        const projectsInfo   = document.createElement('span');
        projectsInfo.className = 'resource-status-projects';
        projectsInfo.textContent = `${activeProjects}P/${activeTasks}T`;
        labelDiv.appendChild(projectsInfo);

        // Tooltip ricco
        const tooltipLines = [`${resource.firstName} ${resource.lastName}`, ''];
        if (currentAbsenceType) {
            const absNames = { vacation: 'In ferie', sick: 'Malattia', planned_intervention: 'Intervento pianificato' };
            tooltipLines.push(`⚠ Stato: ${absNames[currentAbsenceType] || 'Assente'}`);
        } else {
            tooltipLines.push(`Carico oggi: ${todayLoad.toFixed(0)}%`);
        }
        tooltipLines.push(`Progetti: ${activeProjects} | Task: ${activeTasks}`, '');
        Object.values(projectGroups).forEach(({ project, tasks: pTasks }) => {
            const activeCount = pTasks.filter(t => t.status !== 'completata' && t.status !== 'annullata').length;
            const dates = pTasks.reduce((acc, t) => {
                if (!acc.min || t.startDate < acc.min) acc.min = t.startDate;
                const eEnd = getEffectiveEndDate(t);
                if (!acc.max || eEnd > acc.max) acc.max = eEnd;
                return acc;
            }, { min: null, max: null });
            tooltipLines.push(`📁 ${project.code} — ${activeCount} task (${dates.min} → ${dates.max})`);
        });
        if (!currentAbsenceType && resource.absences && resource.absences.length > 0) {
            const futureLimit = new Date(todayDate);
            futureLimit.setDate(futureLimit.getDate() + 30);
            const nextAbs = resource.absences
                .filter(a => new Date(a.start) > todayDate && new Date(a.start) <= futureLimit)
                .sort((a, b) => a.start.localeCompare(b.start))[0];
            if (nextAbs) {
                const absNames = { vacation: 'Ferie', sick: 'Malattia', planned_intervention: 'Intervento' };
                tooltipLines.push('', `⏭ Prossima assenza: ${absNames[nextAbs.type] || 'Assenza'} dal ${nextAbs.start} al ${nextAbs.end}`);
            }
        }
        labelDiv.title = tooltipLines.join('\n');

        // Barra di carico giornaliero nella riga risorsa
        const barsDiv = resourceRow.querySelector('.gantt-row-bars');
        barsDiv.innerHTML = '';
        barsDiv.style.height   = '100%';
        barsDiv.style.position = 'relative';

        days.forEach(day => {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'gantt-day';
            dayDiv.style.cssText = 'position:relative;height:100%;display:flex;flex-direction:column;justify-content:flex-end;';

            const weekNum = getWeekNumber(day);
            dayDiv.classList.add(weekNum % 2 === 0 ? 'week-even' : 'week-odd');

            const dayOfWeek = day.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) dayDiv.classList.add('weekend');

            // Assenze risorsa
            if (resource.absences && resource.absences.length > 0) {
                const dayDate = new Date(day); dayDate.setHours(0, 0, 0, 0);
                resource.absences.forEach(absence => {
                    const absStart = new Date(absence.start); absStart.setHours(0, 0, 0, 0);
                    const absEnd   = new Date(absence.end);   absEnd.setHours(0, 0, 0, 0);
                    if (dayDate >= absStart && dayDate <= absEnd) {
                        if (absence.type === 'sick') dayDiv.classList.add('absence-sick');
                        else if (absence.type === 'planned_intervention') dayDiv.classList.add('absence-planned-intervention');
                        else dayDiv.classList.add('absence');
                    }
                });
            }

            // Festivi
            const holDateStr = formatDateLocal(day);
            const holiday = state.holidays.find(h => h.date === holDateStr);
            if (holiday) { dayDiv.classList.add('holiday'); dayDiv.title = holiday.name; }

            // Oggi
            const checkDay = new Date(day); checkDay.setHours(0, 0, 0, 0);
            if (checkDay.getTime() === todayDate.getTime()) dayDiv.classList.add('today');

            const load    = overload.dailyLoad[holDateStr] || 0;
            const loadBar = document.createElement('div');
            loadBar.style.width = '100%';
            if (load > 0) {
                loadBar.style.height          = `${Math.min(load / 150 * 100, 100)}%`;
                loadBar.style.backgroundColor = getColorForLoad(load);
                loadBar.style.borderRadius    = '2px 2px 0 0';
                loadBar.style.minHeight       = '2px';
                loadBar.title = `${holDateStr}: ${load.toFixed(0)}%`;
            } else {
                loadBar.style.height          = '0';
                loadBar.style.backgroundColor = 'transparent';
            }
            dayDiv.appendChild(loadBar);
            barsDiv.appendChild(dayDiv);
        });

        container.appendChild(resourceRow);

        // Sotto-gruppi per progetto
        Object.values(projectGroups).forEach(({ project, tasks }) => {
            const projectRow     = createGanttRow(`  📁 ${project.code}`, days, 'resource-project', project.id, resource.id);
            projectRow.dataset.resourceId = resource.id;
            projectRow.dataset.projectId  = project.id;
            projectRow.style.backgroundColor = 'var(--bg-tertiary)';
            projectRow.style.fontWeight      = '600';
            const pColor = projectColorMap[project.id] || '#5b8db8';
            projectRow.style.borderLeft = `3px solid ${pColor}`;

            const projectLabelDiv  = projectRow.querySelector('.gantt-row-label');
            const projectExpandIcon = document.createElement('span');
            projectExpandIcon.className  = 'gantt-expand-icon';
            projectExpandIcon.textContent = '▼';
            projectExpandIcon.style.marginLeft = '10px';
            projectExpandIcon.onclick = e => {
                e.stopPropagation();
                toggleGanttResourceProject(resource.id, project.id);
            };
            projectLabelDiv.insertBefore(projectExpandIcon, projectLabelDiv.firstChild);

            container.appendChild(projectRow);

            // Barre aggregate sul progetto
            if (tasks && tasks.length > 0) {
                tasks.forEach(task => {
                    addGanttBar(projectRow, task.startDate, task.endDate, task.name, days, minDate, 'project', null, task);
                });
            }

            // Righe task
            tasks.forEach(task => {
                const taskRow = createGanttRow(`    ${task.name} (${task.percentage}%)`, days, 'resource-project-task', null, resource.id);
                taskRow.dataset.resourceId = resource.id;
                taskRow.dataset.projectId  = project.id;
                container.appendChild(taskRow);

                let barClass = 'task';
                if (task.status === 'nessuno')    barClass += ' status-none';
                if (task.status === 'completata') barClass += ' status-completed';
                if (task.status === 'pausa')      barClass += ' status-paused';
                if (task.status === 'annullata')  barClass += ' status-cancelled';

                addGanttBar(taskRow, task.startDate, task.endDate, task.name, days, minDate, barClass, () => {
                    state.setCurrentProjectId(task.project.id);
                    if (typeof window.openTaskModal === 'function') window.openTaskModal(task.id);
                }, task);

                const effectiveEnd = getEffectiveEndDate(task);
                if (effectiveEnd > task.endDate) {
                    const nextDay = new Date(task.endDate);
                    nextDay.setDate(nextDay.getDate() + 1);
                    addGanttBar(taskRow, formatDateLocal(nextDay), effectiveEnd, '', days, minDate, 'task delay-extension', () => {
                        state.setCurrentProjectId(task.project.id);
                        if (typeof window.openTaskModal === 'function') window.openTaskModal(task.id);
                    }, task);
                }
            });
        });
    });
}

// ─── Collapse / Expand ────────────────────────────────────────────────────────

export function collapseAllGanttProjects() {
    const currentView = document.getElementById('ganttViewFilter')?.value;
    if (currentView === 'resources') {
        document.querySelectorAll('.gantt-row[data-row-type="resource-project"]').forEach(row => {
            const icon = row.querySelector('.gantt-expand-icon');
            if (icon && icon.textContent === '▼') toggleGanttResourceProject(row.dataset.resourceId, row.dataset.projectId);
        });
        document.querySelectorAll('.gantt-row[data-row-type="resource"]').forEach(row => {
            const icon = row.querySelector('.gantt-expand-icon');
            if (icon && icon.textContent === '▼') toggleGanttResource(row.dataset.resourceId);
        });
    } else {
        document.querySelectorAll('.gantt-row[data-row-type="project"]').forEach(row => {
            const icon = row.querySelector('.gantt-expand-icon');
            if (icon && icon.textContent === '▼') toggleGanttProject(row.dataset.projectId);
        });
    }
}

export function expandAllGanttProjects() {
    const currentView = document.getElementById('ganttViewFilter')?.value;
    if (currentView === 'resources') {
        document.querySelectorAll('.gantt-row[data-row-type="resource"]').forEach(row => {
            const icon = row.querySelector('.gantt-expand-icon');
            if (icon && icon.textContent === '▶') toggleGanttResource(row.dataset.resourceId);
        });
        document.querySelectorAll('.gantt-row[data-row-type="resource-project"]').forEach(row => {
            const icon = row.querySelector('.gantt-expand-icon');
            if (icon && icon.textContent === '▶') toggleGanttResourceProject(row.dataset.resourceId, row.dataset.projectId);
        });
    } else {
        document.querySelectorAll('.gantt-row[data-row-type="project"]').forEach(row => {
            const icon = row.querySelector('.gantt-expand-icon');
            if (icon && icon.textContent === '▶') toggleGanttProject(row.dataset.projectId);
        });
    }
}

export function toggleGanttCompactMode() {
    const container = document.querySelector('.gantt-chart');
    if (!container) return;
    const isCompact = document.getElementById('ganttCompactMode')?.checked || false;
    container.classList.toggle('compact-mode', isCompact);
}

// ─── Helpers privati: Toggle collapse ─────────────────────────────────────────

function toggleGanttProject(projectId) {
    const projectRow = document.querySelector(`.gantt-row[data-row-type="project"][data-project-id="${projectId}"]`);
    if (!projectRow) return;
    const icon        = projectRow.querySelector('.gantt-expand-icon');
    const isCollapsed = icon.textContent === '▶';

    document.querySelectorAll(`.gantt-row[data-project-id="${projectId}"]`).forEach(row => {
        if (row.dataset.rowType !== 'project') {
            row.classList.toggle('hidden', !isCollapsed);
        }
    });
    icon.textContent = isCollapsed ? '▼' : '▶';
}

function toggleGanttResource(resourceId) {
    const resourceRow = document.querySelector(`.gantt-row[data-row-type="resource"][data-resource-id="${resourceId}"]`);
    if (!resourceRow) return;
    const icon        = resourceRow.querySelector('.gantt-expand-icon');
    const isCollapsed = icon.textContent === '▶';

    document.querySelectorAll(`.gantt-row[data-resource-id="${resourceId}"]`).forEach(row => {
        if (row.dataset.rowType === 'resource-project') {
            row.classList.toggle('hidden', !isCollapsed);
        } else if (row.dataset.rowType === 'resource-project-task') {
            if (!isCollapsed) {
                row.classList.add('hidden');
            } else {
                const projId    = row.dataset.projectId;
                const projRow   = document.querySelector(`.gantt-row[data-row-type="resource-project"][data-resource-id="${resourceId}"][data-project-id="${projId}"]`);
                const projIcon  = projRow?.querySelector('.gantt-expand-icon');
                const isExpanded = projIcon?.textContent === '▼';
                row.classList.toggle('hidden', !isExpanded);
            }
        }
    });
    icon.textContent = isCollapsed ? '▼' : '▶';
}

function toggleGanttResourceProject(resourceId, projectId) {
    const projectRow = document.querySelector(`.gantt-row[data-row-type="resource-project"][data-resource-id="${resourceId}"][data-project-id="${projectId}"]`);
    if (!projectRow) return;
    const icon        = projectRow.querySelector('.gantt-expand-icon');
    const isCollapsed = icon.textContent === '▶';

    document.querySelectorAll(`.gantt-row[data-resource-id="${resourceId}"][data-project-id="${projectId}"]`).forEach(row => {
        if (row.dataset.rowType === 'resource-project-task') {
            row.classList.toggle('hidden', !isCollapsed);
        }
    });
    icon.textContent = isCollapsed ? '▼' : '▶';
}

// ─── Helpers privati: Stato Gantt ─────────────────────────────────────────────

export function saveGanttState() {
    const container = document.getElementById('ganttChart');
    if (!container) return null;

    const dayWidth = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--gantt-day-width'));
    const scrollLeft = container.scrollLeft;
    const scrollTop  = container.scrollTop;

    const collapsedProjects = [];
    container.querySelectorAll('.gantt-expand-icon').forEach(icon => {
        if (icon.textContent === '▶') {
            const row = icon.closest('.gantt-row');
            if (row) collapsedProjects.push({
                projectId:  row.dataset.projectId,
                resourceId: row.dataset.resourceId,
                rowType:    row.dataset.rowType
            });
        }
    });
    return { dayWidth, scrollLeft, scrollTop, collapsedProjects };
}

export function restoreGanttState(savedState) {
    if (!savedState) return;
    const container = document.getElementById('ganttChart');
    if (!container) return;

    if (savedState.dayWidth) {
        document.documentElement.style.setProperty('--gantt-day-width', `${savedState.dayWidth}px`);
        container.classList.toggle('zoomed-out', savedState.dayWidth < 30);
        updateGanttBarsWidth(container);
    }

    if (savedState.collapsedProjects && savedState.collapsedProjects.length > 0) {
        savedState.collapsedProjects.forEach(item => {
            if (item.rowType === 'project') {
                const row  = document.querySelector(`.gantt-row[data-row-type="project"][data-project-id="${item.projectId}"]`);
                const icon = row?.querySelector('.gantt-expand-icon');
                if (icon && icon.textContent === '▼') toggleGanttProject(item.projectId);
            } else if (item.rowType === 'resource') {
                const row  = document.querySelector(`.gantt-row[data-row-type="resource"][data-resource-id="${item.resourceId}"]`);
                const icon = row?.querySelector('.gantt-expand-icon');
                if (icon && icon.textContent === '▼') toggleGanttResource(item.resourceId);
            } else if (item.rowType === 'resource-project') {
                const row  = document.querySelector(`.gantt-row[data-row-type="resource-project"][data-resource-id="${item.resourceId}"][data-project-id="${item.projectId}"]`);
                const icon = row?.querySelector('.gantt-expand-icon');
                if (icon && icon.textContent === '▼') toggleGanttResourceProject(item.resourceId, item.projectId);
            }
        });
    }

    setTimeout(() => {
        if (savedState.scrollLeft !== undefined) container.scrollLeft = savedState.scrollLeft;
        if (savedState.scrollTop  !== undefined) container.scrollTop  = savedState.scrollTop;
    }, 50);
}

// ─── Helpers privati: DOM ─────────────────────────────────────────────────────

function setupGanttInteractions(container) {
    if (container._wheelHandler)     container.removeEventListener('wheel', container._wheelHandler);
    if (container._mouseDownHandler) container.removeEventListener('mousedown', container._mouseDownHandler);

    const wheelHandler = function(e) {
        if (e.shiftKey && e.deltaY !== 0) {
            e.preventDefault();
            const currentWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gantt-day-width'));
            const delta    = e.deltaY > 0 ? -5 : 5;
            const newWidth = Math.max(15, Math.min(200, currentWidth + delta));
            document.documentElement.style.setProperty('--gantt-day-width', `${newWidth}px`);
            container.classList.toggle('zoomed-out', newWidth < 30);
            updateGanttBarsWidth(container);
        }
    };

    let isDragging = false, startX, startY, scrollLeft, scrollTop;

    const mouseDownHandler = function(e) {
        if (e.target.closest('.gantt-row-bars') || e.target.closest('.gantt-timeline')) {
            isDragging = true;
            startX     = e.pageX - container.offsetLeft;
            startY     = e.pageY - container.offsetTop;
            scrollLeft = container.scrollLeft;
            scrollTop  = container.scrollTop;
            container.style.cursor = 'grabbing';
            e.preventDefault();
        }
    };

    const mouseMoveHandler = function(e) {
        if (!isDragging) return;
        e.preventDefault();
        container.scrollLeft = scrollLeft - (e.pageX - container.offsetLeft - startX) * 1.5;
        container.scrollTop  = scrollTop  - (e.pageY - container.offsetTop  - startY) * 1.5;
    };

    const mouseUpHandler = function() {
        isDragging = false;
        container.style.cursor = 'default';
    };

    container._wheelHandler     = wheelHandler;
    container._mouseDownHandler = mouseDownHandler;

    container.addEventListener('wheel',     wheelHandler,     { passive: false });
    container.addEventListener('mousedown', mouseDownHandler);
    document.addEventListener('mousemove',  mouseMoveHandler);
    document.addEventListener('mouseup',    mouseUpHandler);

    container.addEventListener('scroll', function() {
        const sl = container.scrollLeft;
        container.querySelectorAll('.gantt-row-label').forEach(l => {
            l.style.transform = `translateX(${sl}px)`;
        });
        container.querySelectorAll('.gantt-timeline-label').forEach(l => {
            l.style.transform = `translateX(${sl}px)`;
        });
    }, { passive: true });
}

function updateGanttBarsWidth(container) {
    const dayWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gantt-day-width'));
    container.querySelectorAll('.gantt-bar').forEach(bar => {
        if (bar._startIndex !== undefined && bar._endIndex !== undefined) {
            bar.style.left = `${bar._startIndex * dayWidth}px`;
            if (bar.classList.contains('milestone')) {
                bar.style.left = `${bar._startIndex * dayWidth + 10}px`;
            } else {
                bar.style.width = `${(bar._endIndex - bar._startIndex + 1) * dayWidth}px`;
            }
        }
    });
    const todayLine = container.querySelector('.gantt-today-line');
    if (todayLine && todayLine._todayIndex !== undefined) {
        todayLine.style.left = `${250 + todayLine._todayIndex * dayWidth}px`;
    }
}

function createGanttRow(label, days, rowType, projectId, resourceId) {
    const row = document.createElement('div');
    row.className = 'gantt-row';
    if (rowType)    row.dataset.rowType   = rowType;
    if (projectId != null) row.dataset.projectId  = projectId;

    const labelDiv = document.createElement('div');
    labelDiv.className = 'gantt-row-label';

    if (rowType === 'project') {
        const expandIcon = document.createElement('span');
        expandIcon.className  = 'gantt-expand-icon';
        expandIcon.textContent = '▼';
        expandIcon.onclick = e => { e.stopPropagation(); toggleGanttProject(projectId); };
        labelDiv.appendChild(expandIcon);
    }

    const labelText = document.createElement('span');
    labelText.textContent = label;
    labelDiv.appendChild(labelText);
    row.appendChild(labelDiv);

    const barsDiv = document.createElement('div');
    barsDiv.className = 'gantt-row-bars';

    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const resource = resourceId ? state.resources.find(r => r.id === resourceId) : null;

    days.forEach(day => {
        const dayDiv     = document.createElement('div');
        dayDiv.className = 'gantt-day';

        const weekNum = getWeekNumber(day);
        dayDiv.classList.add(weekNum % 2 === 0 ? 'week-even' : 'week-odd');

        const dayOfWeek = day.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) dayDiv.classList.add('weekend');

        const dateStr = formatDateLocal(day);
        const holiday = state.holidays.find(h => h.date === dateStr);
        if (holiday) { dayDiv.classList.add('holiday'); dayDiv.title = holiday.name; }

        const checkDay = new Date(day); checkDay.setHours(0, 0, 0, 0);
        if (checkDay.getTime() === today.getTime()) dayDiv.classList.add('today');

        if (resource && resource.absences && resource.absences.length > 0) {
            const dayDate = new Date(day); dayDate.setHours(0, 0, 0, 0);
            resource.absences.forEach(absence => {
                const absStart = new Date(absence.start); absStart.setHours(0, 0, 0, 0);
                const absEnd   = new Date(absence.end);   absEnd.setHours(0, 0, 0, 0);
                if (dayDate >= absStart && dayDate <= absEnd) {
                    if (absence.type === 'sick') dayDiv.classList.add('absence-sick');
                    else if (absence.type === 'planned_intervention') dayDiv.classList.add('absence-planned-intervention');
                    else dayDiv.classList.add('absence');
                }
            });
        }

        barsDiv.appendChild(dayDiv);
    });

    row.appendChild(barsDiv);
    return row;
}

function addGanttBar(row, startDate, endDate, label, days, minDate, className, onClickCallback, task) {
    const start    = new Date(startDate); start.setHours(0, 0, 0, 0);
    const end      = new Date(endDate);   end.setHours(0, 0, 0, 0);
    const firstDay = new Date(days[0]);   firstDay.setHours(0, 0, 0, 0);
    const lastDay  = new Date(days[days.length - 1]); lastDay.setHours(0, 0, 0, 0);

    if (end < firstDay || start > lastDay) return;

    let startIndex = days.findIndex(d => formatDateLocal(d) === startDate);
    let endIndex   = days.findIndex(d => formatDateLocal(d) === endDate);

    if (startIndex === -1 && start < firstDay) startIndex = 0;
    if (endIndex   === -1 && end   > lastDay)  endIndex   = days.length - 1;
    if (startIndex === -1 || endIndex === -1)   return;

    const dayWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gantt-day-width'));

    // Crea segmenti separati (giorni lavorativi vs pausa per assenza)
    let segmentStart = null;
    let segmentIsOnAbsence = false;

    for (let i = startIndex; i <= endIndex; i++) {
        const day       = days[i];
        const dayOfWeek = day.getDay();
        const dateStr   = formatDateLocal(day);
        const isSaturday = dayOfWeek === 6;
        const isSunday   = dayOfWeek === 0;
        const isHoliday  = state.holidays.some(h => h.date === dateStr);

        const allResourcesAbsent = task && task.resources
            ? areAllResourcesAbsent(dateStr, task.resources) : false;

        let isNonWorking = false;
        if (isHoliday  && !(task && task.holidayWork))  isNonWorking = true;
        if (isSaturday && !(task && task.saturdayWork)) isNonWorking = true;
        if (isSunday   && !(task && task.sundayWork))   isNonWorking = true;

        if (!isNonWorking) {
            const isOnAbsence = allResourcesAbsent;
            if (segmentStart === null) {
                segmentStart       = i;
                segmentIsOnAbsence = isOnAbsence;
            } else if (segmentIsOnAbsence !== isOnAbsence) {
                createBarSegment(row, segmentStart, i - 1, label, startDate, endDate, className, onClickCallback, dayWidth, task, segmentIsOnAbsence);
                segmentStart       = i;
                segmentIsOnAbsence = isOnAbsence;
            }
        } else {
            if (segmentStart !== null) {
                createBarSegment(row, segmentStart, i - 1, label, startDate, endDate, className, onClickCallback, dayWidth, task, segmentIsOnAbsence);
                segmentStart = null;
            }
        }
    }
    if (segmentStart !== null) {
        createBarSegment(row, segmentStart, endIndex, label, startDate, endDate, className, onClickCallback, dayWidth, task, segmentIsOnAbsence);
    }
}

function createBarSegment(row, startIndex, endIndex, label, originalStart, originalEnd, className, onClickCallback, dayWidth, task, isOnAbsence) {
    const bar = document.createElement('div');
    let barClassName = `gantt-bar ${className}`;
    if (isOnAbsence) barClassName += ' on-absence';
    bar.className   = barClassName;
    bar.textContent = task && task.nightWork ? `🌙 ${label}` : label;

    let tooltipText = `${label}\n${originalStart} - ${originalEnd}`;
    if (task && task.nightWork) tooltipText += `\n🌙 Notturno: ${task.nightWork}`;
    if (isOnAbsence)            tooltipText += '\n⚠️ In pausa per assenza risorse';
    if (task && task.status === 'in-ritardo' && task.endDate) {
        const daysLate = Math.floor((new Date() - new Date(task.endDate)) / (1000 * 60 * 60 * 24));
        if (daysLate > 0) tooltipText += `\n🔴 In ritardo di ${daysLate} giorni`;
        if (task.resources && task.resources.length > 1) {
            tooltipText += '\n--- Completamento risorse ---';
            task.resources.forEach(res => {
                const r    = state.resources.find(rr => rr.id == res.resourceId);
                const name = r ? `${r.firstName} ${r.lastName}` : 'N/A';
                const icon = (res.completion || 0) >= 100 ? '✅' : '⏳';
                tooltipText += `\n${icon} ${name}: ${res.completion || 0}%`;
            });
        }
    }
    bar.title = tooltipText;

    const numDays = endIndex - startIndex + 1;
    bar._startIndex = startIndex;
    bar._endIndex   = endIndex;
    bar._startDate  = originalStart;
    bar._endDate    = originalEnd;

    if (onClickCallback) {
        bar.style.cursor = 'pointer';
        bar.onclick = onClickCallback;
    }

    bar.style.left = `${startIndex * dayWidth}px`;

    if (className === 'milestone') {
        bar.style.left = `${startIndex * dayWidth + 10}px`;
    } else {
        bar.style.width    = `${numDays * dayWidth}px`;
        bar.style.minWidth = `${Math.max(numDays * dayWidth, dayWidth * 0.8)}px`;

        if (task && task.completion > 0) {
            const completionBar     = document.createElement('div');
            completionBar.className = 'gantt-completion-bar';
            completionBar.style.width = `${task.completion}%`;
            completionBar.title       = `Completamento: ${task.completion}%`;
            bar.appendChild(completionBar);
        }
    }

    row.querySelector('.gantt-row-bars').appendChild(bar);
}

// ─── Helpers privati: calcoli ─────────────────────────────────────────────────

function getWeekNumber(date) {
    const d      = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getEffectiveEndDate(task) {
    if (task.status === 'in-ritardo' && task.completion < 100 && task.endDate) {
        const today = formatDateLocal(new Date());
        if (task.endDate < today) return today;
    }
    return task.endDate;
}

function getEffectiveEndDateForResource(task, resourceId) {
    if (!task.endDate) return task.endDate;

    const res           = task.resources && task.resources.find(r => r.resourceId == resourceId);
    const resCompletion = res ? (parseInt(res.completion, 10) || 0) : (parseInt(task.completion, 10) || 0);

    if (resCompletion >= 100 && task.completion < 100) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = formatDateLocal(yesterday);
        return task.endDate > yesterdayStr ? yesterdayStr : task.endDate;
    }

    if (task.status === 'in-ritardo' && task.completion < 100) {
        const today = formatDateLocal(new Date());
        if (task.endDate < today) return today;
    }

    return task.endDate;
}

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

        const end      = new Date(endDateStr); end.setHours(0, 0, 0, 0);
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
        const dateStr  = formatDateLocal(date);
        const isHoliday = state.holidays.some(h => h.date === dateStr);
        if (isHoliday) return false;
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

function calculateProjectStats(project) {
    let startDate = null;
    let endDate   = null;
    let totalWeightedCompletion = 0;
    let totalDuration = 0;

    if (project.milestones) {
        project.milestones.forEach(m => {
            if (!startDate || m.date < startDate) startDate = m.date;
            if (!endDate   || m.date > endDate)   endDate   = m.date;
        });
    }

    if (project.tasks) {
        project.tasks.forEach(task => {
            if (task.status === 'annullata') return;
            if (task.startDate && (!startDate || task.startDate < startDate)) startDate = task.startDate;
            if (task.endDate   && (!endDate   || task.endDate   > endDate))   endDate   = task.endDate;
            const duration   = parseInt(task.duration || 1);
            const completion = parseInt(task.completion || 0);
            totalWeightedCompletion += (duration * completion) / 100;
            totalDuration += duration;
        });
    }

    const completion    = totalDuration > 0 ? Math.round((totalWeightedCompletion / totalDuration) * 100) : 100;
    const remainingDays = totalDuration > 0 ? Math.round(totalDuration - totalWeightedCompletion) : 0;
    return { startDate, endDate, completion, remainingDays, totalDuration };
}
