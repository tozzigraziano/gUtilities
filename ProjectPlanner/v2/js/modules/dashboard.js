/**
 * js/modules/dashboard.js
 *
 * Rendering della Dashboard: riepilogo attività di oggi, milestone imminenti,
 * risorse assenti/fuori sede, riunioni del giorno, appunti calendario,
 * panoramica progetti attivi.
 *
 * Dipendenze v2:
 *   - ../state.js         → projects, resources, meetings, holidays, plants, quickNotes
 *   - ../helpers.js       → escapeHtml, formatDateLocal
 *   - ./quickNotes.js     → getQuickNotesForDashboard
 *
 * Funzioni esposte su window da app.js:
 *   window.renderDashboard   = Dashboard.renderDashboard
 *   window.navigateToProject = Dashboard.navigateToProject
 */

import * as state from '../state.js';
import { escapeHtml, formatDateLocal } from '../helpers.js';
import { getQuickNotesForDashboard } from './quickNotes.js';

// ─── Navigazione ──────────────────────────────────────────────────────────────

/**
 * Naviga al dettaglio di un progetto (switch tab + apri progetto).
 * Viene esposta su window per i handler inline onclick.
 */
export function navigateToProject(projectId) {
    if (typeof window.switchTab === 'function') {
        window.switchTab('projects');
    }
    setTimeout(() => {
        if (typeof window.openProjectDetails === 'function') {
            window.openProjectDetails(projectId);
        }
    }, 100);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/** Renderizza l'intera dashboard nel contenitore #dashboardContainer. */
export function renderDashboard() {
    const container = document.getElementById('dashboardContainer');
    if (!container) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = formatDateLocal(today);

    const dateEl = document.getElementById('dashboardDate');
    if (dateEl) {
        dateEl.textContent = today.toLocaleDateString('it-IT', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    }

    // Raccogli dati
    const todayTasks         = [];
    const overdueTasks       = [];
    const upcomingMilestones = [];
    const todayMilestones    = [];
    const offSiteResources   = new Map();
    const absentResources    = [];
    const permitResources    = [];
    const inProgressProjects = [];
    const todayMeetings      = [];

    const dashboardQuickNotes = getQuickNotesForDashboard();
    const pendingQuickNotes   = state.quickNotes.filter(note => !note.confirmed).length;

    // Analisi progetti e attività
    state.projects.forEach(project => {
        let hasActiveTasks = false;

        // Milestone
        if (project.milestones) {
            project.milestones.forEach(m => {
                if (m.date === todayStr) {
                    todayMilestones.push({ milestone: m, project });
                } else {
                    const mDate   = new Date(m.date + 'T00:00:00');
                    const diffDays = Math.ceil((mDate - today) / 86400000);
                    if (diffDays > 0 && diffDays <= 7) {
                        upcomingMilestones.push({ milestone: m, project, daysLeft: diffDays });
                    }
                }
            });
        }

        // Tasks
        if (project.tasks) {
            project.tasks.forEach(task => {
                if (task.status === 'completata' || task.status === 'annullata') return;
                if (task.completion >= 100) return;

                hasActiveTasks = true;
                const taskStart = task.startDate ? new Date(task.startDate) : null;
                const taskEnd   = task.endDate   ? new Date(task.endDate)   : null;

                if (taskStart && taskEnd) {
                    taskStart.setHours(0, 0, 0, 0);
                    taskEnd.setHours(23, 59, 59, 999);

                    // Attiva oggi
                    if (taskStart <= today && taskEnd >= today) {
                        todayTasks.push({ task, project });

                        // Fuori sede
                        if (task.locationType === 'cliente' && task.resources) {
                            task.resources.forEach(tr => {
                                if (tr.resourceId) {
                                    const r = state.resources.find(res => res.id == tr.resourceId);
                                    if (r) {
                                        const plantName = task.plantId
                                            ? (state.plants.find(p => p.id == task.plantId)?.name || '')
                                            : '';
                                        const key = r.id;
                                        if (!offSiteResources.has(key)) {
                                            offSiteResources.set(key, { resource: r, tasks: [] });
                                        }
                                        offSiteResources.get(key).tasks.push({ task, project, plantName });
                                    }
                                }
                            });
                        }
                    }

                    // In ritardo
                    if (taskEnd < today && task.completion < 100
                        && task.status !== 'pausa' && task.status !== 'annullata') {
                        overdueTasks.push({ task, project });
                    }
                }
            });
        }

        if (hasActiveTasks) {
            const activeTasks    = project.tasks.filter(t => t.status !== 'annullata');
            const avgCompletion  = activeTasks.length > 0
                ? Math.round(activeTasks.reduce((sum, t) => sum + (t.completion || 0), 0) / activeTasks.length)
                : 0;
            inProgressProjects.push({ project, avgCompletion, taskCount: activeTasks.length });
        }
    });

    // Risorse assenti / con permessi oggi
    state.resources.forEach(resource => {
        if (resource.hidden) return;
        if (resource.absences) {
            resource.absences.forEach(abs => {
                const absStart = new Date(abs.start);
                absStart.setHours(0, 0, 0, 0);
                const absEnd = new Date(abs.end || abs.start);
                absEnd.setHours(23, 59, 59, 999);
                if (absStart <= today && absEnd >= today) {
                    const typeLabels = { vacation: 'Ferie', sick: 'Malattia', permit: 'Permesso', other: 'Altro' };
                    absentResources.push({
                        resource,
                        type: typeLabels[abs.type] || abs.type || 'Assenza'
                    });
                }
            });
        }
        if (resource.permits) {
            resource.permits.forEach(permit => {
                if (permit.date === todayStr) {
                    const now     = new Date();
                    const nowTime = now.getHours().toString().padStart(2, '0') + ':'
                                  + now.getMinutes().toString().padStart(2, '0');
                    const isActive = nowTime >= permit.startTime && nowTime <= permit.endTime;
                    permitResources.push({
                        resource,
                        startTime: permit.startTime,
                        endTime:   permit.endTime,
                        isActive
                    });
                }
            });
        }
    });

    // Riunioni di oggi (globali)
    if (state.meetings) {
        state.meetings.forEach(m => {
            if (m.date === todayStr) todayMeetings.push(m);
        });
    }
    // Riunioni dai progetti
    state.projects.forEach(project => {
        if (project.meetings) {
            project.meetings.forEach(m => {
                if (m.date === todayStr) {
                    todayMeetings.push({ ...m, projectClient: project.client, projectCode: project.code });
                }
            });
        }
    });
    todayMeetings.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    // Ordina
    overdueTasks.sort((a, b) => new Date(a.task.endDate) - new Date(b.task.endDate));
    upcomingMilestones.sort((a, b) => a.daysLeft - b.daysLeft);

    // Build HTML
    let html = '';

    // Statistiche riassuntive
    html += '<div class="dashboard-stat-row">';
    html += `<div class="dashboard-stat"><div class="stat-value">${todayTasks.length}</div><div class="stat-label">Attività in corso oggi</div></div>`;
    html += `<div class="dashboard-stat"><div class="stat-value" style="color: ${overdueTasks.length > 0 ? '#f44336' : 'inherit'}">${overdueTasks.length}</div><div class="stat-label">Attività in ritardo</div></div>`;
    html += `<div class="dashboard-stat"><div class="stat-value">${offSiteResources.size}</div><div class="stat-label">Risorse fuori sede</div></div>`;
    html += `<div class="dashboard-stat"><div class="stat-value" style="color: ${(absentResources.length + permitResources.length) > 0 ? '#ff9800' : 'inherit'}">${absentResources.length + permitResources.length}</div><div class="stat-label">Risorse assenti</div></div>`;
    html += `<div class="dashboard-stat"><div class="stat-value">${todayMilestones.length}</div><div class="stat-label">Milestone oggi</div></div>`;
    html += `<div class="dashboard-stat"><div class="stat-value">${todayMeetings.length}</div><div class="stat-label">Riunioni oggi</div></div>`;
    html += `<div class="dashboard-stat"><div class="stat-value" style="color: ${pendingQuickNotes > 0 ? '#fb8c00' : 'inherit'}">${pendingQuickNotes}</div><div class="stat-label">Appunti da confermare</div></div>`;
    html += '</div>';

    html += '<div class="dashboard-grid">';

    // Card: Milestone prossimi 7 giorni (incluso oggi)
    const allUpcomingMilestones = [
        ...todayMilestones.map(item => ({ ...item, daysLeft: 0 })),
        ...upcomingMilestones
    ].sort((a, b) => a.daysLeft - b.daysLeft);

    if (allUpcomingMilestones.length > 0) {
        html += '<div class="dashboard-card">';
        html += '<h3>📅 Milestone prossimi 7 giorni</h3>';
        html += '<ul class="dashboard-list">';
        allUpcomingMilestones.forEach(item => {
            const isToday    = item.daysLeft === 0;
            const badgeClass = isToday ? 'danger' : item.daysLeft <= 2 ? 'danger' : item.daysLeft <= 4 ? 'warning' : 'info';
            const badgeText  = isToday ? 'Oggi' : `${item.daysLeft}g — ${item.milestone.date}`;
            html += `<li${isToday ? ' style="background: var(--warning-bg);"' : ''}>
                <div>
                    <strong>${isToday ? '🚩 ' : ''}${escapeHtml(item.milestone.name)}</strong><br>
                    <small style="color: var(--text-tertiary);">${escapeHtml(item.project.client)} — ${escapeHtml(item.project.code)}</small>
                </div>
                <span class="dashboard-badge ${badgeClass}">${badgeText}</span>
            </li>`;
        });
        html += '</ul></div>';
    }

    // Card: Attività in ritardo
    if (overdueTasks.length > 0) {
        html += '<div class="dashboard-card">';
        html += '<h3>🔴 Attività in ritardo</h3>';
        html += '<ul class="dashboard-list">';
        overdueTasks.slice(0, 15).forEach(item => {
            const daysLate = Math.ceil((today - new Date(item.task.endDate)) / 86400000);
            html += `<li style="cursor:pointer;" onclick="navigateToProject(${item.project.id})" title="Vai al progetto">
                <div>
                    <strong>${escapeHtml(item.task.name)}</strong><br>
                    <small style="color: var(--text-tertiary);">${escapeHtml(item.project.client)} — ${escapeHtml(item.project.code)}</small>
                </div>
                <span class="dashboard-badge danger">${daysLate}g ritardo · ${item.task.completion || 0}%</span>
            </li>`;
        });
        if (overdueTasks.length > 15) {
            html += `<li class="dashboard-empty">...e altre ${overdueTasks.length - 15} attività</li>`;
        }
        html += '</ul></div>';
    }

    // Card: Risorse assenti
    html += '<div class="dashboard-card">';
    html += '<h3>🚫 Risorse assenti oggi</h3>';
    if (absentResources.length > 0 || permitResources.length > 0) {
        html += '<ul class="dashboard-list">';
        absentResources.forEach(item => {
            const typeClass  = item.type === 'Malattia' ? 'danger' : item.type === 'Ferie' ? 'warning' : 'muted';
            const isVacation = item.type === 'Ferie';
            html += `<li${isVacation ? ' class="vacation-highlight"' : ''}>
                <span>${isVacation ? '🏖️ ' : ''}${escapeHtml(item.resource.firstName)} ${escapeHtml(item.resource.lastName)}</span>
                <span class="dashboard-badge ${typeClass}">${item.type}</span>
            </li>`;
        });
        permitResources.forEach(item => {
            const badgeClass = item.isActive ? 'permit-active' : 'muted';
            const activeIcon = item.isActive ? '⏰ ' : '';
            html += `<li${item.isActive ? ' style="background: var(--warning-bg);"' : ''}>
                <span>${escapeHtml(item.resource.firstName)} ${escapeHtml(item.resource.lastName)}</span>
                <span class="dashboard-badge ${badgeClass}">${activeIcon}Permesso ${item.startTime} - ${item.endTime}</span>
            </li>`;
        });
        html += '</ul>';
    } else {
        html += '<p class="dashboard-empty">Nessuna risorsa assente oggi</p>';
    }
    html += '</div>';

    // Card: Risorse fuori sede
    html += '<div class="dashboard-card">';
    html += '<h3>🏢 Risorse fuori sede oggi</h3>';
    if (offSiteResources.size > 0) {
        html += '<ul class="dashboard-list">';
        offSiteResources.forEach(item => {
            const taskDetails = item.tasks.map(t =>
                `${escapeHtml(t.project.client)} — ${escapeHtml(t.task.name)}${t.plantName ? ' @ ' + escapeHtml(t.plantName) : ''}`
            ).join('<br>');
            html += `<li style="flex-direction: column; align-items: flex-start;">
                <strong>${escapeHtml(item.resource.firstName)} ${escapeHtml(item.resource.lastName)}</strong>
                <small style="color: var(--text-tertiary);">${taskDetails}</small>
            </li>`;
        });
        html += '</ul>';
    } else {
        html += '<p class="dashboard-empty">Nessuna risorsa fuori sede oggi</p>';
    }
    html += '</div>';

    // Card: Riunioni di oggi
    html += '<div class="dashboard-card">';
    html += '<h3>👥 Riunioni di oggi</h3>';
    if (todayMeetings.length > 0) {
        html += '<ul class="dashboard-list">';
        todayMeetings.forEach(m => {
            const time  = m.time || '';
            const title = m.title || m.subject || 'Riunione';
            const ctx   = m.projectClient ? `${m.projectClient} — ${m.projectCode}` : '';
            html += `<li>
                <div>
                    ${time ? '<strong>' + escapeHtml(time) + '</strong> — ' : ''}${escapeHtml(title)}
                    ${ctx ? '<br><small style="color: var(--text-tertiary);">' + escapeHtml(ctx) + '</small>' : ''}
                </div>
            </li>`;
        });
        html += '</ul>';
    } else {
        html += '<p class="dashboard-empty">Nessuna riunione programmata per oggi</p>';
    }
    html += '</div>';

    // Card: Appunti calendario (oggi + arretrati non confermati)
    html += '<div class="dashboard-card">';
    html += '<h3>🗒️ Appunti calendario</h3>';
    if (dashboardQuickNotes.length > 0) {
        html += '<ul class="dashboard-list">';
        dashboardQuickNotes.slice(0, 20).forEach(note => {
            const isOverdue   = !note.confirmed && note.date < todayStr;
            const statusClass = note.confirmed ? 'success' : isOverdue ? 'danger' : 'warning';
            const statusText  = note.confirmed ? 'Confermato' : isOverdue ? 'In sospeso' : 'Da confermare';
            const tagsText    = (note.tags && note.tags.length > 0)
                ? note.tags.map(t => '#' + t).join(' ')
                : '';
            html += `<li${isOverdue ? ' style="background: var(--warning-bg);"' : ''}>
                <div>
                    <strong>${escapeHtml(note.time || '--:--')}</strong> - ${escapeHtml(note.text || '')}<br>
                    <small style="color: var(--text-tertiary);">${escapeHtml(note.date || '')}${tagsText ? ' - ' + escapeHtml(tagsText) : ''}</small>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="dashboard-badge ${statusClass}">${statusText}</span>
                    <input type="checkbox" ${note.confirmed ? 'checked' : ''} onchange="toggleQuickNoteConfirmed(${note.id}, this.checked)" title="Conferma appunto" style="cursor:pointer;">
                </div>
            </li>`;
        });
        if (dashboardQuickNotes.length > 20) {
            html += `<li class="dashboard-empty">...e altri ${dashboardQuickNotes.length - 20} appunti</li>`;
        }
        html += '</ul>';
    } else {
        html += '<p class="dashboard-empty">Nessun appunto da mostrare oggi.</p>';
    }
    html += '</div>';

    // Card: Attività attive oggi (tabella full-width)
    html += '<div class="dashboard-card" style="grid-column: 1 / -1;">';
    html += '<h3>📋 Attività attive oggi (' + todayTasks.length + ')</h3>';
    if (todayTasks.length > 0) {
        html += '<table style="width: 100%; font-size: 0.85em;"><thead><tr>';
        html += '<th>Cliente</th><th>Codice</th><th>Attività</th><th>Risorse</th><th>Luogo</th><th>Completamento</th>';
        html += '</tr></thead><tbody>';
        todayTasks.forEach(item => {
            const resNames = (item.task.resources || []).map(tr => {
                const r = state.resources.find(res => res.id == tr.resourceId);
                return r ? `${r.firstName} ${r.lastName}` : '';
            }).filter(Boolean).join(', ') || '-';

            let location = 'In sede';
            if (item.task.locationType === 'cliente') {
                const plant = item.task.plantId
                    ? state.plants.find(p => p.id == item.task.plantId)
                    : null;
                location = plant ? plant.name : 'Presso cliente';
            }

            const compClass = item.task.completion >= 75 ? 'success'
                            : item.task.completion >= 40 ? 'warning' : 'danger';
            html += `<tr style="cursor:pointer;" onclick="navigateToProject(${item.project.id})" title="Vai al progetto">
                <td>${escapeHtml(item.project.client)}</td>
                <td>${escapeHtml(item.project.code)}</td>
                <td>${escapeHtml(item.task.name)}</td>
                <td>${escapeHtml(resNames)}</td>
                <td>${escapeHtml(location)}</td>
                <td><span class="dashboard-badge ${compClass}">${item.task.completion || 0}%</span></td>
            </tr>`;
        });
        html += '</tbody></table>';
    } else {
        html += '<p class="dashboard-empty">Nessuna attività attiva oggi.</p>';
    }
    html += '</div>';

    // Card: Panoramica Progetti attivi (tabella full-width)
    html += '<div class="dashboard-card" style="grid-column: 1 / -1;">';
    html += '<h3>📈 Progetti attivi (' + inProgressProjects.length + ')</h3>';
    if (inProgressProjects.length > 0) {
        html += '<table style="width: 100%; font-size: 0.85em;"><thead><tr>';
        html += '<th>Cliente</th><th>Codice</th><th>Attività</th><th>Completamento medio</th>';
        html += '</tr></thead><tbody>';
        inProgressProjects.sort((a, b) => a.avgCompletion - b.avgCompletion).forEach(item => {
            const compClass = item.avgCompletion >= 75 ? 'success'
                            : item.avgCompletion >= 40 ? 'warning' : 'danger';
            html += `<tr style="cursor:pointer;" onclick="navigateToProject(${item.project.id})" title="Vai al progetto">
                <td>${escapeHtml(item.project.client)}</td>
                <td>${escapeHtml(item.project.code)}</td>
                <td>${item.taskCount}</td>
                <td>
                    <div class="project-progress-container" style="display:inline-block; width: 120px; vertical-align: middle;">
                        <div class="project-progress-fill ${compClass}" style="width: ${item.avgCompletion}%;"></div>
                        <span class="project-progress-text">${item.avgCompletion}%</span>
                    </div>
                </td>
            </tr>`;
        });
        html += '</tbody></table>';
    } else {
        html += '<p class="dashboard-empty">Nessun progetto attivo.</p>';
    }
    html += '</div>';

    html += '</div>'; // chiude dashboard-grid

    container.innerHTML = html;
}
