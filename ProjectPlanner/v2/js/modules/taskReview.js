/**
 * js/modules/taskReview.js
 *
 * Tab "Revisione Attività": elenco attività con data flessibile o in pausa,
 * selezione multipla per analisi disponibilità risorse, export testo riepilogo.
 *
 * Dipendenze v2:
 *   - ../state.js    → projects, resources, holidays, selectedTasksForAnalysis
 *   - ../helpers.js  → escapeHtml, formatDateLocal, getLocationBadgeHtml
 *
 * Funzioni esposte su window da app.js:
 *   window.renderTaskReview            = TaskReview.renderTaskReview
 *   window.toggleTaskSelection         = TaskReview.toggleTaskSelection
 *   window.analyzeSelectedTasks        = TaskReview.analyzeSelectedTasks
 *   window.updateTaskReviewTotal       = TaskReview.updateTaskReviewTotal
 *   window.toggleAllTaskReviewSelection = TaskReview.toggleAllTaskReviewSelection
 *   window.sendTaskReviewEmail         = TaskReview.sendTaskReviewEmail
 *   window.openTaskFromReview          = TaskReview.openTaskFromReview
 *   window.closeAnalyzeResourcesPanel  = TaskReview.closeAnalyzeResourcesPanel  (opzionale, condiviso)
 */

import * as state from '../state.js';
import { escapeHtml, formatDateLocal, getLocationBadgeHtml } from '../helpers.js';

// ─── Navigazione ──────────────────────────────────────────────────────────────

/** Imposta il progetto corrente e apre il modal di modifica del task. */
export function openTaskFromReview(taskId, projectId) {
    state.setCurrentProjectId(projectId);
    if (typeof window.openTaskModal === 'function') {
        window.openTaskModal(taskId);
    }
}

// ─── Selezione ────────────────────────────────────────────────────────────────

/**
 * Toggle della selezione di un task per l'analisi risorse.
 * Usa state.selectedTasksForAnalysis (Set di task ID).
 *
 * @param {number}  taskId  - ID del task
 * @param {boolean} checked - true = seleziona, false = deseleziona
 */
export function toggleTaskSelection(taskId, checked) {
    if (checked) {
        state.selectedTasksForAnalysis.add(taskId);
    } else {
        state.selectedTasksForAnalysis.delete(taskId);
    }
}

/** Seleziona/deseleziona tutti i checkbox visibili nella tabella. */
export function toggleAllTaskReviewSelection() {
    const selectAll  = document.getElementById('taskReviewSelectAll');
    const checkboxes = document.querySelectorAll('.task-review-checkbox');
    checkboxes.forEach(cb => { cb.checked = selectAll.checked; });
    updateTaskReviewTotal();
}

/** Aggiorna il contatore dei giorni totali selezionati. */
export function updateTaskReviewTotal() {
    const checkboxes = document.querySelectorAll('.task-review-checkbox:checked');
    let totalDays    = 0;
    checkboxes.forEach(cb => {
        totalDays += parseFloat(cb.getAttribute('data-task-time')) || 0;
    });

    const totalSpan = document.getElementById('taskReviewTotalDays');
    if (totalSpan) totalSpan.textContent = totalDays.toFixed(2);

    // Stato checkbox "seleziona tutto"
    const allCheckboxes = document.querySelectorAll('.task-review-checkbox');
    const selectAll     = document.getElementById('taskReviewSelectAll');
    if (selectAll && allCheckboxes.length > 0) {
        selectAll.checked      = allCheckboxes.length === checkboxes.length;
        selectAll.indeterminate = checkboxes.length > 0 && checkboxes.length < allCheckboxes.length;
    }
}

// ─── Analisi risorse ──────────────────────────────────────────────────────────

/**
 * Analizza la disponibilità delle risorse per i task selezionati tramite checkbox.
 * Calcola le sovrapposizioni con le attività già assegnate e mostra un ranking.
 * Scrive il risultato in un pannello dinamico dopo la tabella taskReview.
 */
export function analyzeSelectedTasks() {
    // Raccogli task selezionati dai checkbox (multi-progetto)
    const checkboxes   = document.querySelectorAll('.task-review-checkbox:checked');
    const selectedKeys = [];
    checkboxes.forEach(cb => {
        const key = cb.getAttribute('data-task-key');
        if (key) selectedKeys.push(key);
    });

    if (selectedKeys.length === 0) {
        alert('Seleziona almeno un\'attività per l\'analisi.');
        return;
    }

    // Recupera i task dai progetti corrispondenti alle chiavi "projectId-taskId"
    const selectedTasks = selectedKeys.map(key => {
        const [projectId, taskId] = key.split('-').map(Number);
        const project = state.projects.find(p => p.id === projectId);
        const task    = project?.tasks?.find(t => t.id === taskId);
        return task && task.startDate && task.endDate ? task : null;
    }).filter(Boolean);

    if (selectedTasks.length === 0) {
        alert('Seleziona almeno un\'attività con date definite (inizio e fine) per l\'analisi.');
        return;
    }

    // Risorse visibili
    const visibleResources = state.resources.filter(r => !r.hidden);
    if (visibleResources.length === 0) {
        alert('Nessuna risorsa visibile. Rendi visibili le risorse nella tab Risorse.');
        return;
    }

    // Per ogni risorsa calcola i giorni di sovrapposizione con attività già assegnate
    const results = visibleResources.map(resource => {
        let overlapDays = 0;

        selectedTasks.forEach(task => {
            let current    = new Date(task.startDate + 'T00:00:00');
            const end      = new Date(task.endDate   + 'T00:00:00');

            while (current <= end) {
                const dateStr  = formatDateLocal(current);
                const dow      = current.getDay();
                const isHoliday = state.holidays.some(h => h.date === dateStr);

                // Salta giorni non lavorativi del task selezionato
                if ((dow === 6 && !task.saturdayWork)
                    || (dow === 0 && !task.sundayWork)
                    || (isHoliday && !task.holidayWork)) {
                    current.setDate(current.getDate() + 1);
                    continue;
                }

                // Controlla se la risorsa ha già un'attività attiva in questo giorno
                const hasAssignment = state.projects.some(proj =>
                    proj.tasks && proj.tasks.some(ot => {
                        if (!ot.startDate || !ot.endDate) return false;
                        if (ot.completion >= 100 || ot.status === 'completata' || ot.status === 'annullata') return false;
                        if (!ot.resources) return false;
                        const res = ot.resources.find(r => r.resourceId == resource.id);
                        if (!res) return false;
                        return dateStr >= ot.startDate && dateStr <= ot.endDate;
                    })
                );

                if (hasAssignment) overlapDays++;
                current.setDate(current.getDate() + 1);
            }
        });

        return { resource, overlapDays };
    });

    results.sort((a, b) => a.overlapDays - b.overlapDays);
    const maxOverlap = Math.max(...results.map(r => r.overlapDays), 1);

    const taskNames = selectedTasks.map(t => escapeHtml(t.name)).join(', ');
    const taskDates = selectedTasks.map(t => `${t.startDate} → ${t.endDate}`).join(' | ');

    let html = `<h4>🔍 Analisi sovrapposizioni per: <em>${taskNames}</em></h4>`;
    html += `<div style="font-size:11px; color:var(--text-secondary); margin-bottom:5px;">Periodo: ${taskDates}</div>`;
    html += `<div style="font-size:11px; color:var(--text-secondary); margin-bottom:10px;">Risorse visibili ordinate per sovrapposizione crescente — 0 = completamente libera nel periodo</div>`;

    const medals = ['🥇', '🥈', '🥉'];
    results.forEach((r, i) => {
        const pct       = maxOverlap > 0 ? (r.overlapDays / maxOverlap) * 100 : 0;
        const barClass  = r.overlapDays === 0 ? 'zero' : pct < 35 ? 'low' : pct < 70 ? 'mid' : 'high';
        const rankLabel = i < 3 ? medals[i] : `${i + 1}.`;
        const daysLabel = r.overlapDays === 0
            ? '<span style="color:#4CAF50;font-weight:bold;">✅ Libera</span>'
            : `<span style="color:var(--text-secondary);">⚡ ${r.overlapDays} gg sovrapp.</span>`;
        html += `<div class="analyze-resource-row">
            <span class="analyze-rank">${rankLabel}</span>
            <span class="analyze-name">${escapeHtml(r.resource.firstName + ' ' + r.resource.lastName)}</span>
            <span class="analyze-days">${daysLabel}</span>
            <div class="analyze-bar-wrap"><div class="analyze-bar ${barClass}" style="width:${Math.max(pct, r.overlapDays > 0 ? 3 : 0)}%"></div></div>
        </div>`;
    });

    html += `<div style="margin-top:10px; text-align:right;">
        <button onclick="closeTaskReviewAnalysisPanel()" class="secondary" style="font-size:11px; padding:3px 8px;">✖ Chiudi</button>
    </div>`;

    // Mostra/crea il pannello di analisi nella tab taskReview
    let panel = document.getElementById('taskReviewAnalysisPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id        = 'taskReviewAnalysisPanel';
        panel.className = 'analyze-resources-panel';
        const table     = document.getElementById('taskReviewTable');
        if (table) table.parentNode.appendChild(panel);
        else document.getElementById('taskReview')?.appendChild(panel);
    }
    panel.innerHTML = html;
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Chiude il pannello di analisi risorse nella tab taskReview. */
export function closeTaskReviewAnalysisPanel() {
    const panel = document.getElementById('taskReviewAnalysisPanel');
    if (panel) panel.style.display = 'none';
}

// ─── Export testo ─────────────────────────────────────────────────────────────

/**
 * Raccoglie i task selezionati e copia negli appunti un riepilogo testuale
 * strutturato per codice lavoro.
 */
export function sendTaskReviewEmail() {
    const checkboxes = document.querySelectorAll('.task-review-checkbox:checked');

    if (checkboxes.length === 0) {
        alert('Seleziona almeno un\'attività da includere nel riepilogo');
        return;
    }

    // Raccogli i task selezionati
    const selectedTasks = [];
    checkboxes.forEach(cb => {
        const taskKey              = cb.getAttribute('data-task-key');
        const [projectId, taskId] = taskKey.split('-').map(Number);
        const project              = state.projects.find(p => p.id === projectId);
        const task                 = project?.tasks?.find(t => t.id === taskId);

        if (project && task) {
            let resourcesStr = '-';
            let totalLoad    = 0;
            if (task.resources && task.resources.length > 0) {
                const resourceNames = [];
                task.resources.forEach(r => {
                    totalLoad += r.percentage || 0;
                    if (r.resourceId) {
                        const resource = state.resources.find(res => res.id == r.resourceId);
                        if (resource) resourceNames.push(`${resource.firstName} ${resource.lastName} (${r.percentage}%)`);
                    }
                });
                resourcesStr = resourceNames.length > 0 ? resourceNames.join(', ') : '-';
            }
            selectedTasks.push({
                client:      project.client,
                code:        project.code,
                description: project.description || '-',
                taskName:    task.name,
                resources:   resourcesStr,
                load:        (task.resources && task.resources.length > 0) ? `${totalLoad}%` : '-',
                duration:    task.duration,
                notes:       task.notes || ''
            });
        }
    });

    // Raggruppa per codice lavoro
    const groupedByCode = {};
    selectedTasks.forEach(task => {
        if (!groupedByCode[task.code]) {
            groupedByCode[task.code] = { client: task.client, description: task.description, tasks: [] };
        }
        groupedByCode[task.code].tasks.push({
            name:      task.taskName,
            resources: task.resources,
            load:      task.load,
            duration:  task.duration,
            notes:     task.notes
        });
    });

    const totalDays  = parseFloat(document.getElementById('taskReviewTotalDays')?.textContent) || 0;
    const numProjects = Object.keys(groupedByCode).length;
    const numTasks    = selectedTasks.length;

    let emailBody = 'DETTAGLI ATTIVITÀ ESPORTATE CON FILTRO\n';
    emailBody += '='.repeat(80) + '\n\n';
    emailBody += `Numero di progetti interessati: ${numProjects}\n`;
    emailBody += `Numero di attività: ${numTasks}\n`;
    emailBody += `Stima del tempo totale di completamento: ${totalDays.toFixed(2)} giorni\n\n`;

    emailBody += 'ELENCO COMPATTO:\n';
    emailBody += '-'.repeat(80) + '\n';
    const sortedTasks = [...selectedTasks].sort((a, b) => a.code.localeCompare(b.code));
    sortedTasks.forEach(task => {
        emailBody += `☐  [${task.code}] ${task.description} → ${task.taskName}\n`;
    });
    emailBody += '\n' + '='.repeat(80) + '\n\n';

    emailBody += 'DETTAGLIO ATTIVITÀ PER CODICE LAVORO\n';
    emailBody += '='.repeat(80) + '\n\n';
    const sortedCodes = Object.keys(groupedByCode).sort();
    for (const code of sortedCodes) {
        const group = groupedByCode[code];
        emailBody += `▶ ${code} - ${group.client}\n`;
        emailBody += `  ${group.description}\n`;
        emailBody += '-'.repeat(80) + '\n';
        group.tasks.forEach((task, index) => {
            const estimatedTime = (task.duration * (parseFloat(task.load) / 100)).toFixed(2);
            emailBody += `\n  ${index + 1}. ATTIVITÀ: ${task.name.toUpperCase()}\n`;
            emailBody += `     Risorse: ${task.resources}\n`;
            emailBody += `     Stima tempo completamento: ${estimatedTime} giorni\n`;
            if (task.notes && task.notes.trim()) {
                emailBody += `\n     Note:\n`;
                task.notes.split('\n').forEach(line => {
                    if (line.trim()) emailBody += `     - ${line.trim()}\n`;
                });
            }
            emailBody += '\n';
        });
        emailBody += '\n' + '='.repeat(80) + '\n\n';
    }
    emailBody += `\nTEMPO TOTALE: ${totalDays.toFixed(2)} giorni\n`;

    navigator.clipboard.writeText(emailBody).then(() => {
        alert('✅ Riepilogo copiato negli appunti!\n\nApri il tuo client di posta e incolla (Ctrl+V) il contenuto nel corpo dell\'email.');
    }).catch(() => {
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:20px;box-shadow:0 4px 6px rgba(0,0,0,0.3);z-index:10000;max-width:80%;max-height:80%;overflow:auto;';
        modal.innerHTML = `
            <h3>Riepilogo Attività</h3>
            <p>Copia il testo qui sotto e incollalo nella tua email:</p>
            <textarea style="width:100%;height:400px;font-family:monospace;font-size:12px;">${escapeHtml(emailBody)}</textarea>
            <button onclick="this.parentElement.remove()">Chiudi</button>
        `;
        document.body.appendChild(modal);
    });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/** Renderizza la tabella della tab "Revisione Attività". */
export function renderTaskReview() {
    const tbody = document.querySelector('#taskReviewTable tbody');
    if (!tbody) return;

    // Preserva selezioni correnti
    const preservedKeys = new Set();
    document.querySelectorAll('.task-review-checkbox:checked').forEach(cb => {
        const key = cb.getAttribute('data-task-key');
        if (key) preservedKeys.add(key);
    });

    tbody.innerHTML = '';

    const filterClient      = document.getElementById('taskReviewFilterClient')?.value.toLowerCase()     || '';
    const filterCode        = document.getElementById('taskReviewFilterCode')?.value.toLowerCase()       || '';
    const filterDescription = document.getElementById('taskReviewFilterDescription')?.value.toLowerCase() || '';
    const filterTaskName    = document.getElementById('taskReviewFilterTaskName')?.value.toLowerCase()   || '';
    const filterResource    = document.getElementById('taskReviewFilterResource')?.value                 || '';
    const hidePaused        = document.getElementById('taskReviewHidePaused')?.checked                  || false;

    // Raccogli attività con data flessibile o in pausa
    const reviewTasks = [];
    state.projects.forEach(project => {
        if (!project.tasks) return;
        project.tasks.forEach(task => {
            const isPaused = task.status === 'pausa';
            if ((task.flexibleDate || isPaused) && !(hidePaused && isPaused)) {
                reviewTasks.push({ project, task });
            }
        });
    });

    // Applica filtri
    let filteredTasks = reviewTasks;
    if (filterClient)      filteredTasks = filteredTasks.filter(item => (item.project.client      || '').toLowerCase().includes(filterClient));
    if (filterCode)        filteredTasks = filteredTasks.filter(item => (item.project.code        || '').toLowerCase().includes(filterCode));
    if (filterDescription) filteredTasks = filteredTasks.filter(item => (item.project.description || '').toLowerCase().includes(filterDescription));
    if (filterTaskName)    filteredTasks = filteredTasks.filter(item => (item.task.name           || '').toLowerCase().includes(filterTaskName));
    if (filterResource) {
        if (filterResource === 'unassigned') {
            filteredTasks = filteredTasks.filter(item =>
                !item.task.resources || item.task.resources.length === 0
                || !item.task.resources.some(r => r.resourceId)
            );
        } else {
            filteredTasks = filteredTasks.filter(item =>
                item.task.resources && item.task.resources.some(r => r.resourceId == filterResource)
            );
        }
    }

    // Ordina per cliente poi per nome attività
    filteredTasks.sort((a, b) => {
        const clientCmp = (a.project.client || '').localeCompare(b.project.client || '');
        if (clientCmp !== 0) return clientCmp;
        return (a.task.name || '').localeCompare(b.task.name || '');
    });

    // Renderizza righe
    filteredTasks.forEach(item => {
        const { project, task } = item;
        const tr = document.createElement('tr');

        if (task.flexibleDate)    tr.className = 'task-flexible-date';
        else if (task.status === 'pausa') tr.className = 'status-paused';

        // Risorse e carico
        let resourcesStr = '-';
        let totalLoad    = 0;
        if (task.resources && task.resources.length > 0) {
            const resourceNames = [];
            task.resources.forEach(r => {
                totalLoad += r.percentage || 0;
                if (r.resourceId) {
                    const resource = state.resources.find(res => res.id == r.resourceId);
                    if (resource) resourceNames.push(`${resource.firstName} ${resource.lastName} (${r.percentage}%)`);
                }
            });
            resourcesStr = resourceNames.length > 0 ? resourceNames.join(', ') : '-';
        }
        const loadStr = (task.resources && task.resources.length > 0) ? `${totalLoad}%` : '-';

        // Indicatori tipo
        let typeIndicator = '';
        if (task.flexibleDate) {
            typeIndicator = '<span style="color: var(--info-color); font-weight: bold;" title="Attività con data flessibile">💡 Data Flessibile</span>';
        }
        if (task.status === 'pausa') {
            typeIndicator += (typeIndicator ? '<br>' : '') + '<span style="color: var(--warning-color); font-weight: bold;" title="Attività in pausa">⏸️ In Pausa</span>';
        }

        // Indicatore note
        const notesIndicator = task.notes && task.notes.trim()
            ? `<span style="color: var(--warning-color); margin-left: 5px; cursor: help;" title="${task.notes.replace(/"/g, '&quot;').replace(/\n/g, '&#10;')}">📝</span>`
            : '';

        // Tempo stimato (durata * carico%)
        const taskTime = (task.duration || 0) * (totalLoad / 100);
        const taskKey  = `${project.id}-${task.id}`;
        const isSelected = preservedKeys.has(taskKey);

        tr.innerHTML = `
            <td><input type="checkbox" class="task-review-checkbox" data-task-time="${taskTime}" data-task-key="${taskKey}" onchange="updateTaskReviewTotal()" ${isSelected ? 'checked' : ''}></td>
            <td>${escapeHtml(project.client)}</td>
            <td>${escapeHtml(project.code)}</td>
            <td>${escapeHtml(project.description || '-')}</td>
            <td>${escapeHtml(task.name)}${notesIndicator}</td>
            <td>${escapeHtml(resourcesStr)}</td>
            <td>${escapeHtml(loadStr)}</td>
            <td>${task.duration} giorni</td>
            <td>${typeIndicator}</td>
            <td>${getLocationBadgeHtml(task)}</td>
            <td class="action-buttons">
                <button onclick="openTaskFromReview(${task.id}, ${project.id})" class="secondary" title="Modifica attività">✏️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Contatore attività
    const countMsg = filteredTasks.length === reviewTasks.length
        ? `Trovate ${filteredTasks.length} attività`
        : `Mostrate ${filteredTasks.length} di ${reviewTasks.length} attività`;

    const existingCount = document.querySelector('#taskReview .task-count');
    if (existingCount) {
        existingCount.textContent = countMsg;
    } else {
        const countDiv      = document.createElement('div');
        countDiv.className  = 'task-count';
        countDiv.style.cssText = 'margin-bottom:10px; color:var(--text-secondary); font-style:italic;';
        countDiv.textContent = countMsg;
        const table = document.getElementById('taskReviewTable');
        table?.parentNode.insertBefore(countDiv, table);
    }

    // Riga totale tempo (creata una sola volta)
    const existingTotal = document.querySelector('#taskReview .task-total-time');
    if (!existingTotal) {
        const totalDiv      = document.createElement('div');
        totalDiv.className  = 'task-total-time';
        totalDiv.style.cssText = 'margin-top:10px; padding:10px; background:var(--bg-secondary); border-radius:4px; display:flex; align-items:center; gap:20px;';
        totalDiv.innerHTML  = `
            <span style="font-weight: bold; color: var(--accent-color);">Tempo totale selezionato: <span id="taskReviewTotalDays">0</span> giorni</span>
            <button onclick="sendTaskReviewEmail()" style="margin-left: auto;">&#x1F4CB; Copia negli appunti</button>
            <button onclick="analyzeSelectedTasks()" class="secondary">🔍 Analizza risorse</button>
        `;
        const table = document.getElementById('taskReviewTable');
        table?.parentNode.appendChild(totalDiv);
    }

    updateTaskReviewTotal();

    // Popola la select risorse con conteggi
    const resourceSelect = document.getElementById('taskReviewFilterResource');
    if (resourceSelect) {
        const currentValue    = resourceSelect.value;
        const resourceCounts  = {};
        let unassignedCount   = 0;

        reviewTasks.forEach(item => {
            if (!item.task.resources || item.task.resources.length === 0
                || !item.task.resources.some(r => r.resourceId)) {
                unassignedCount++;
            } else {
                item.task.resources.forEach(r => {
                    if (r.resourceId) {
                        resourceCounts[r.resourceId] = (resourceCounts[r.resourceId] || 0) + 1;
                    }
                });
            }
        });

        resourceSelect.innerHTML = '<option value="">Tutte le risorse</option>';

        if (unassignedCount > 0) {
            const opt   = document.createElement('option');
            opt.value   = 'unassigned';
            opt.textContent = `Non assegnate (${unassignedCount})`;
            resourceSelect.appendChild(opt);
        }

        state.resources.forEach(resource => {
            const count = resourceCounts[resource.id] || 0;
            if (count > 0) {
                const opt   = document.createElement('option');
                opt.value   = resource.id;
                opt.textContent = `${resource.firstName} ${resource.lastName} (${count})`;
                resourceSelect.appendChild(opt);
            }
        });

        resourceSelect.value = currentValue;
    }
}
