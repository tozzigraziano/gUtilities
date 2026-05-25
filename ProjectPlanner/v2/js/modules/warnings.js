/**
 * js/modules/warnings.js
 *
 * Raccolta e rendering degli avvisi di sistema: sovraccarichi risorse, attività
 * in ritardo, assenze durante attività, risorse mancanti, date mancanti,
 * progetti vuoti, attività in pausa.
 *
 * Nota: questo modulo è read-only (nessuna operazione DB).
 * Legge esclusivamente da state.projects, state.resources, state.holidays.
 *
 * Dipendenze v2:
 *   - ../state.js   → state.projects, state.resources, state.holidays,
 *                     state.setCurrentProjectId
 *   - ../helpers.js → formatDateLocal, escapeHtml, areAllResourcesAbsent,
 *                     calculateEndDateForTask
 */

import * as state from '../state.js';
import {
    formatDateLocal,
    escapeHtml,
    areAllResourcesAbsent,
    calculateEndDateForTask
} from '../helpers.js';

// ─── Costanti ──────────────────────────────────────────────────────────────────
const WARNING_FILTER_IDS = [
    'sovraccarico', 'ritardo', 'assenze',
    'nessuna_risorsa', 'senza_date', 'progetto_vuoto', 'pausa'
];

// ─── Helper privati ────────────────────────────────────────────────────────────

/**
 * Restituisce la data di fine effettiva di un task per una risorsa specifica.
 * Se la risorsa ha completamento al 100% ma il task no, considera la risorsa
 * libera da ieri (evita sovraccarichi residui).
 * Per task in ritardo, estende la data di fine fino a oggi.
 */
function getEffectiveEndDateForResource(task, resourceId) {
    if (!task.endDate) return task.endDate;

    const res = task.resources && task.resources.find(r => r.resourceId == resourceId);
    const resCompletion = res
        ? (parseInt(res.completion, 10) || 0)
        : (parseInt(task.completion, 10) || 0);

    if (resCompletion >= 100 && task.completion < 100) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
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

/**
 * Verifica se una data è lavorativa per il task specificato,
 * considerando weekend, festività e assenze di tutte le risorse assegnate.
 */
function isWorkingDay(date, task) {
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 6 && !task.saturdayWork) return false;
    if (dayOfWeek === 0 && !task.sundayWork)   return false;

    if (!task.holidayWork) {
        const dateStr   = formatDateLocal(date);
        const isHoliday = state.holidays.some(h => h.date === dateStr);
        if (isHoliday) return false;
    }

    const dateStr       = formatDateLocal(date);
    const taskResources = task.resources || [];
    if (areAllResourcesAbsent(dateStr, taskResources)) return false;

    return true;
}

// ─── Filtri Avvisi ─────────────────────────────────────────────────────────────

/** Carica i filtri da localStorage e aggiorna le checkbox nel DOM. */
export function loadWarningFilters() {
    try {
        const saved = JSON.parse(localStorage.getItem('warningFilters') || '{}');
        WARNING_FILTER_IDS.forEach(id => {
            const el = document.getElementById('wf_' + id);
            if (el) el.checked = saved[id] !== false; // default: abilitato
        });
    } catch (e) { /* ignora errori di parsing */ }
}

/** Salva i filtri correnti in localStorage e ri-renderizza. */
export function saveWarningFilters() {
    const filterState = {};
    WARNING_FILTER_IDS.forEach(id => {
        const el = document.getElementById('wf_' + id);
        if (el) filterState[id] = el.checked;
    });
    localStorage.setItem('warningFilters', JSON.stringify(filterState));
    renderWarnings();
}

/** Mostra o nasconde il pannello dei filtri. */
export function toggleWarningFiltersPanel() {
    const panel = document.getElementById('warningFiltersPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

/** Restituisce true se il tipo di avviso è abilitato nei filtri. */
export function isWarningTypeEnabled(type) {
    const el = document.getElementById('wf_' + type);
    return el ? el.checked : true;
}

// ─── Raccolta Avvisi ───────────────────────────────────────────────────────────

/** Raccoglie tutti gli avvisi correnti da progetti e risorse. */
export function collectAllWarnings() {
    const warnings  = [];
    const today     = formatDateLocal(new Date());
    const projects  = state.projects;
    const resources = state.resources;

    // ── 1. Sovraccarichi di risorse ──────────────────────────────────────────
    resources.forEach(resource => {
        const assignments = [];
        projects.forEach(project => {
            if (!project.tasks) return;
            project.tasks.forEach(task => {
                if (!task.resources || !task.startDate || !task.endDate) return;
                if (task.completion >= 100)              return;
                if (task.status === 'completata')        return;
                if (task.status === 'pausa')             return;
                if (task.status === 'annullata')         return;

                const res = task.resources.find(r => r.resourceId == resource.id);
                if (res) {
                    assignments.push({
                        project, task,
                        percentage: res.percentage,
                        resourceId: resource.id,
                        startDate:  task.startDate,
                        endDate:    getEffectiveEndDateForResource(task, resource.id)
                    });
                }
            });
        });

        // Calcola carico giornaliero
        const dailyLoad = {};
        assignments.forEach(assignment => {
            const start = new Date(assignment.startDate);
            const end   = new Date(assignment.endDate);
            let cur = new Date(start);
            while (cur <= end) {
                if (isWorkingDay(cur, assignment.task)) {
                    const dateStr = formatDateLocal(cur);
                    if (!dailyLoad[dateStr]) dailyLoad[dateStr] = 0;
                    dailyLoad[dateStr] += assignment.percentage;
                }
                cur.setDate(cur.getDate() + 1);
            }
        });

        // Segnala giorni futuri con sovraccarico
        Object.keys(dailyLoad).forEach(dateStr => {
            if (dailyLoad[dateStr] > 100 && dateStr >= today) {
                const tasksOnDay = assignments.filter(a => {
                    const s = new Date(a.startDate);
                    const e = new Date(a.endDate);
                    const d = new Date(dateStr);
                    return d >= s && d <= e;
                });
                warnings.push({
                    type:        'sovraccarico',
                    severity:    'critical',
                    icon:        '🔴',
                    title:       `Sovraccarico ${resource.firstName} ${resource.lastName}`,
                    description: `Il ${dateStr} carico al ${dailyLoad[dateStr].toFixed(0)}% (${tasksOnDay.length} attività in sovrapposizione)`,
                    action:      'Ridistribuire il carico o ripianificare le attività',
                    onClick: () => {
                        if (window.switchTab) window.switchTab('resourceView');
                        const filterEl = document.getElementById('resourceViewFilter');
                        const periodEl = document.getElementById('resourceViewPeriod');
                        const dayEl    = document.getElementById('resourceViewSpecificDay');
                        if (filterEl) filterEl.value = resource.id;
                        if (periodEl) periodEl.value = 'day';
                        if (dayEl)    dayEl.value    = dateStr;
                        if (window.updateResourceViewPeriod) window.updateResourceViewPeriod();
                    }
                });
            }
        });
    });

    // ── 2. Attività in ritardo ────────────────────────────────────────────────
    projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (!task.endDate || task.endDate >= today) return;
            if (task.completion >= 100)         return;
            if (task.status === 'completata')   return;
            if (task.status === 'annullata')    return;
            if (task.status === 'pausa')        return;

            const daysLate = Math.floor((new Date() - new Date(task.endDate)) / (1000 * 60 * 60 * 24));
            let resourceDetail = '';
            if (task.resources && task.resources.length > 1) {
                const details = task.resources.map(res => {
                    const r     = resources.find(rr => rr.id == res.resourceId);
                    const rName = r ? `${r.firstName} ${r.lastName}` : 'N/A';
                    const icon  = (res.completion || 0) >= 100 ? '✅' : '⚠️';
                    return `${icon} ${rName}: ${res.completion || 0}%`;
                }).join(', ');
                resourceDetail = ` | Risorse: ${details}`;
            }
            warnings.push({
                type:        'ritardo',
                severity:    task.completion === 0 ? 'critical' : 'warning',
                icon:        '⏰',
                title:       `Attività in ritardo: ${task.name}`,
                description: `Progetto: ${project.client} (${project.code}) - Scaduta ${daysLate} giorni fa (${task.endDate}). Completamento: ${task.completion}%${resourceDetail}`,
                action:      'Aggiornare la data o il completamento',
                onClick: () => {
                    if (window.switchTab) window.switchTab('projects');
                    state.setCurrentProjectId(project.id);
                    if (window.openTaskModal) window.openTaskModal(task.id);
                }
            });
        });
    });

    // ── 3. Assenze durante attività ───────────────────────────────────────────
    projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (!task.startDate || !task.endDate)              return;
            if (!task.resources || task.resources.length === 0) return;
            if (task.completion >= 100)                         return;
            if (task.status === 'completata')                   return;
            if (task.status === 'annullata')                    return;

            let hasAbsences = false;
            const absenceDays = [];
            let cur = new Date(task.startDate);
            const end = new Date(task.endDate);
            while (cur <= end) {
                const dateStr = formatDateLocal(cur);
                task.resources.forEach(taskRes => {
                    const resource = resources.find(r => r.id == taskRes.resourceId);
                    if (resource && resource.absences) {
                        resource.absences.forEach(absence => {
                            const absStart = new Date(absence.start);
                            const absEnd   = new Date(absence.end);
                            if (cur >= absStart && cur <= absEnd) {
                                hasAbsences = true;
                                if (!absenceDays.includes(dateStr)) absenceDays.push(dateStr);
                            }
                        });
                    }
                });
                cur.setDate(cur.getDate() + 1);
            }
            if (hasAbsences && absenceDays.length > 0) {
                warnings.push({
                    type:        'assenze',
                    severity:    'warning',
                    icon:        '📅',
                    title:       `Assenze durante attività: ${task.name}`,
                    description: `Progetto: ${project.client} (${project.code}) - ${absenceDays.length} giorni con risorse assenti tra ${task.startDate} e ${task.endDate}`,
                    action:      'Verificare e ripianificare se necessario',
                    onClick: () => {
                        if (window.switchTab) window.switchTab('projects');
                        state.setCurrentProjectId(project.id);
                        if (window.openTaskModal) window.openTaskModal(task.id);
                    }
                });
            }
        });
    });

    // ── 4. Attività senza risorse assegnate ───────────────────────────────────
    projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            const hasValidResources = task.resources && task.resources.length > 0 &&
                task.resources.some(tr => tr && tr.resourceId &&
                    resources.some(r => r.id == tr.resourceId));

            if ((!task.resources || task.resources.length === 0 || !hasValidResources) &&
                !task.flexibleDate &&
                task.completion < 100 &&
                task.status !== 'completata' &&
                task.status !== 'annullata') {
                warnings.push({
                    type:        'nessuna_risorsa',
                    severity:    'warning',
                    icon:        '👤',
                    title:       `Nessuna risorsa assegnata: ${task.name}`,
                    description: `Progetto: ${project.client} (${project.code}) - Attività${task.startDate ? ` pianificata dal ${task.startDate}` : ''} senza risorse`,
                    action:      'Assegnare una o più risorse',
                    onClick: () => {
                        if (window.switchTab) window.switchTab('projects');
                        state.setCurrentProjectId(project.id);
                        if (window.openTaskModal) window.openTaskModal(task.id);
                    }
                });
            }
        });
    });

    // ── 5. Attività senza date ────────────────────────────────────────────────
    projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (!task.flexibleDate &&
                (!task.startDate || !task.endDate) &&
                task.status !== 'completata' &&
                task.status !== 'annullata') {
                const missingDates = !task.startDate && !task.endDate
                    ? 'date di inizio e fine'
                    : !task.startDate ? 'data di inizio' : 'data di fine';
                warnings.push({
                    type:        'senza_date',
                    severity:    'warning',
                    icon:        '📅',
                    title:       `Attività senza date: ${task.name}`,
                    description: `Progetto: ${project.client} (${project.code}) - L'attività non ha ${missingDates} assegnate`,
                    action:      'Assegnare le date all\'attività',
                    onClick: () => {
                        if (window.switchTab) window.switchTab('projects');
                        state.setCurrentProjectId(project.id);
                        if (window.openTaskModal) window.openTaskModal(task.id);
                    }
                });
            }
        });
    });

    // ── 6. Progetti senza attività ────────────────────────────────────────────
    projects.forEach(project => {
        if (!project.tasks || project.tasks.length === 0) {
            warnings.push({
                type:        'progetto_vuoto',
                severity:    'info',
                icon:        '📋',
                title:       `Progetto vuoto: ${project.client} (${project.code})`,
                description: `Il progetto "${project.client} - ${project.code}" non ha attività definite`,
                action:      'Aggiungere attività o template',
                onClick: () => {
                    state.setCurrentProjectId(project.id);
                    if (window.switchTab) window.switchTab('projects');
                }
            });
        }
    });

    // ── 7. Attività in pausa ──────────────────────────────────────────────────
    projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (task.status !== 'pausa') return;
            warnings.push({
                type:        'pausa',
                severity:    'info',
                icon:        '⏸️',
                title:       `Attività in pausa: ${task.name}`,
                description: `Progetto: ${project.client} (${project.code}) - Completamento: ${task.completion}%. ${task.startDate && task.endDate ? `Periodo: ${task.startDate} - ${task.endDate}` : 'Date non definite'}`,
                action:      'Riattivare o aggiornare lo stato',
                onClick: () => {
                    if (window.switchTab) window.switchTab('projects');
                    state.setCurrentProjectId(project.id);
                    if (window.openTaskModal) window.openTaskModal(task.id);
                }
            });
        });
    });

    return warnings;
}

// ─── Rendering ─────────────────────────────────────────────────────────────────

/** Renderizza la pagina avvisi con riepilogo e liste per severità. */
export function renderWarnings() {
    loadWarningFilters();
    const container = document.getElementById('warningsContainer');
    if (!container) return;

    const warnings = collectAllWarnings().filter(w => isWarningTypeEnabled(w.type));

    // Riepilogo contatori
    const summary       = document.createElement('div');
    summary.className   = 'warnings-summary';
    const criticalCount = warnings.filter(w => w.severity === 'critical').length;
    const warningCount  = warnings.filter(w => w.severity === 'warning').length;
    const infoCount     = warnings.filter(w => w.severity === 'info').length;

    summary.innerHTML = `
        <div class="warnings-summary-card critical">
            <div class="warnings-summary-number">${criticalCount}</div>
            <div class="warnings-summary-label">Critici</div>
        </div>
        <div class="warnings-summary-card warning">
            <div class="warnings-summary-number">${warningCount}</div>
            <div class="warnings-summary-label">Avvisi</div>
        </div>
        <div class="warnings-summary-card info">
            <div class="warnings-summary-number">${infoCount}</div>
            <div class="warnings-summary-label">Informativi</div>
        </div>
        <div class="warnings-summary-card ${warnings.length === 0 ? 'success' : 'total'}">
            <div class="warnings-summary-number">${warnings.length}</div>
            <div class="warnings-summary-label">Totali</div>
        </div>
    `;

    container.innerHTML = '';
    container.appendChild(summary);

    if (warnings.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'warnings-empty';
        empty.innerHTML = '✅ <strong>Nessun problema rilevato!</strong><br>Tutti i progetti sono in buono stato.';
        container.appendChild(empty);
        return;
    }

    const categories = [
        { severity: 'critical', title: '🚨 Problemi Critici',  warnings: warnings.filter(w => w.severity === 'critical') },
        { severity: 'warning',  title: '⚠️ Avvisi Importanti', warnings: warnings.filter(w => w.severity === 'warning')  },
        { severity: 'info',     title: 'ℹ️ Informazioni',      warnings: warnings.filter(w => w.severity === 'info')     }
    ];

    categories.forEach(category => {
        if (category.warnings.length === 0) return;

        const categoryDiv   = document.createElement('div');
        categoryDiv.className = 'warnings-category';

        const header = document.createElement('div');
        header.className = `warnings-category-header ${category.severity}`;
        header.innerHTML = `
            <span>${category.title}</span>
            <span class="warnings-category-count">${category.warnings.length}</span>
            <span class="warnings-category-toggle">▼</span>
        `;
        header.style.cursor = 'pointer';
        header.onclick = function () {
            const list   = this.nextElementSibling;
            const toggle = this.querySelector('.warnings-category-toggle');
            if (list.style.display === 'none') {
                list.style.display = 'block';
                toggle.textContent = '▼';
            } else {
                list.style.display = 'none';
                toggle.textContent = '▶';
            }
        };
        categoryDiv.appendChild(header);

        const list = document.createElement('div');
        list.className = 'warnings-list';

        category.warnings.forEach(warning => {
            const item = document.createElement('div');
            item.className = `warning-item ${warning.severity}`;
            item.innerHTML = `
                <div class="warning-item-title">${warning.icon} ${warning.title}</div>
                <div class="warning-item-details">${warning.description}</div>
                ${warning.action ? `<div class="warning-item-action">💡 ${warning.action}</div>` : ''}
            `;
            if (warning.onClick) {
                item.style.cursor = 'pointer';
                item.onclick = warning.onClick;
            }
            list.appendChild(item);
        });

        categoryDiv.appendChild(list);
        container.appendChild(categoryDiv);
    });
}

// ─── Export per moduli dipendenti ──────────────────────────────────────────────

/**
 * Trova le attività i cui tempi vengono allungati a causa di assenze delle risorse.
 * Restituisce un array di oggetti { project, task, delayDays, affectedResources }.
 * Usato da resources.js per mostrare il delta tempi nel dettaglio risorsa.
 */
export function findTasksWithAbsenceDelays() {
    const tasksWithDelays = [];

    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            if (task.status === 'completata') return;
            if (!task.resources || task.resources.length === 0) return;
            if (!task.startDate || !task.duration) return;

            const endDateWithoutAbsences = calculateEndDateForTask(
                task.startDate, task.duration,
                task.saturdayWork, task.sundayWork, task.holidayWork,
                []              // nessuna risorsa → nessuna assenza
            );
            const endDateWithAbsences = calculateEndDateForTask(
                task.startDate, task.duration,
                task.saturdayWork, task.sundayWork, task.holidayWork,
                task.resources
            );

            if (endDateWithoutAbsences !== endDateWithAbsences) {
                const delayDays = Math.round(
                    (new Date(endDateWithAbsences) - new Date(endDateWithoutAbsences)) / (1000 * 60 * 60 * 24)
                );
                if (delayDays > 0) {
                    tasksWithDelays.push({
                        project, task, delayDays,
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
