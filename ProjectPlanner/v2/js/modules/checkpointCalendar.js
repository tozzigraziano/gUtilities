/**
 * js/modules/checkpointCalendar.js
 *
 * Calendario Punti di Controllo: visualizzazione mensile/settimanale
 * delle milestone di progetto con navigazione e filtro per cliente.
 */

import * as state from '../state.js';
import { formatDateLocal, escapeHtml } from '../helpers.js';

// ─── Stato locale di navigazione ─────────────────────────────────────────────

// Offset in mesi (o settimane) rispetto al mese/settimana corrente
let _checkpointOffset = 0;

// ─── Helper: raccolta dati ────────────────────────────────────────────────────

function getAllCheckpoints() {
    const checkpoints = [];
    state.projects.forEach(project => {
        if (!project.milestones) return;
        project.milestones.forEach(m => {
            if (m.date) {
                checkpoints.push({
                    name:        m.name,
                    date:        m.date,
                    client:      project.client,
                    code:        project.code,
                    description: project.description || '',
                    projectId:   project.id
                });
            }
        });
    });
    return checkpoints;
}

// ─── Helper: lista elenco periodo ─────────────────────────────────────────────

function renderCheckpointList(checkpoints, startDate, endDate) {
    const startStr = formatDateLocal(startDate);
    const endStr   = formatDateLocal(endDate);

    const filtered = checkpoints
        .filter(cp => cp.date >= startStr && cp.date <= endStr)
        .sort((a, b) => a.date.localeCompare(b.date));

    if (filtered.length === 0) return '';

    let html = '<div class="checkpoint-list-view" style="margin-top: 15px;">';
    html += `<h3 style="margin-bottom: 8px;">📋 Elenco punti di controllo nel periodo (${filtered.length})</h3>`;
    html += '<table><thead><tr>';
    html += '<th>Data</th><th>Punto di Controllo</th><th>Cliente</th><th>Codice Progetto</th><th>Descrizione</th>';
    html += '</tr></thead><tbody>';

    filtered.forEach(cp => {
        const d = new Date(cp.date);
        const dateFormatted = d.toLocaleDateString('it-IT', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
        });
        html += `<tr>
            <td>${dateFormatted}</td>
            <td><strong>🚩 ${escapeHtml(cp.name)}</strong></td>
            <td>${escapeHtml(cp.client || '-')}</td>
            <td>${escapeHtml(cp.code || '-')}</td>
            <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(cp.description || '-')}</td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    return html;
}

// ─── Vista settimanale ────────────────────────────────────────────────────────

function renderWeekView(container, checkpoints, today, label, todayStr) {
    // Lunedì della settimana corrente + offset in settimane
    const startOfWeek = new Date(today);
    const dayOfWeek   = startOfWeek.getDay();
    const diff        = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // lunedì = inizio settimana
    startOfWeek.setDate(startOfWeek.getDate() + diff + (_checkpointOffset * 7));

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);

    const startStr = startOfWeek.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
    const endStr   = endOfWeek.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
    label.textContent = `${startStr} — ${endStr}`;

    // Mappa data → checkpoint
    const cpMap = {};
    checkpoints.forEach(cp => {
        if (!cpMap[cp.date]) cpMap[cp.date] = [];
        cpMap[cp.date].push(cp);
    });

    const dayNames = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

    let html = '<div class="checkpoint-calendar"><div class="checkpoint-calendar-grid week-view">';

    // Header
    for (let i = 0; i < 7; i++) {
        const d       = new Date(startOfWeek);
        d.setDate(d.getDate() + i);
        const dateStr = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
        html += `<div class="checkpoint-cal-header">${dayNames[i]}<br>${dateStr}</div>`;
    }

    // Celle
    for (let i = 0; i < 7; i++) {
        const d         = new Date(startOfWeek);
        d.setDate(d.getDate() + i);
        const dateStr   = formatDateLocal(d);
        const isToday   = dateStr === todayStr;
        const isWeekend = (i === 5 || i === 6);
        const dayItems  = cpMap[dateStr] || [];

        html += `<div class="checkpoint-cal-day${isToday ? ' today' : ''}${isWeekend ? ' weekend' : ''}">`;
        html += `<div class="checkpoint-cal-day-number">${d.getDate()}</div>`;
        dayItems.forEach(cp => {
            html += `<div class="checkpoint-cal-item" title="${escapeHtml(cp.client)} — ${escapeHtml(cp.code)}\n${escapeHtml(cp.description)}">
                <div class="cp-client">${escapeHtml(cp.client)}</div>
                <div class="cp-project">${escapeHtml(cp.code)}</div>
                <div class="cp-name">🚩 ${escapeHtml(cp.name)}</div>
            </div>`;
        });
        html += '</div>';
    }

    html += '</div>';
    html += renderCheckpointList(checkpoints, startOfWeek, endOfWeek);
    html += '</div>';

    container.innerHTML = html;
}

// ─── Vista mensile ────────────────────────────────────────────────────────────

function renderMonthView(container, checkpoints, today, label, todayStr) {
    const refDate = new Date(today.getFullYear(), today.getMonth() + _checkpointOffset, 1);
    const year    = refDate.getFullYear();
    const month   = refDate.getMonth();

    label.textContent = refDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

    const firstDay      = new Date(year, month, 1);
    const lastDay       = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const offset        = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // lunedì = 0

    // Mappa data → checkpoint
    const cpMap = {};
    checkpoints.forEach(cp => {
        if (!cpMap[cp.date]) cpMap[cp.date] = [];
        cpMap[cp.date].push(cp);
    });

    const dayNames   = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    const totalCells = offset + lastDay.getDate();
    const rows       = Math.ceil(totalCells / 7);

    let html = '<div class="checkpoint-calendar"><div class="checkpoint-calendar-grid month-view">';

    // Header
    dayNames.forEach(name => {
        html += `<div class="checkpoint-cal-header">${name}</div>`;
    });

    // Celle
    const calStart = new Date(firstDay);
    calStart.setDate(calStart.getDate() - offset);

    for (let i = 0; i < rows * 7; i++) {
        const d            = new Date(calStart);
        d.setDate(d.getDate() + i);
        const dateStr      = formatDateLocal(d);
        const isToday      = dateStr === todayStr;
        const isOtherMonth = d.getMonth() !== month;
        const dayOfWeek    = d.getDay();
        const isWeekend    = (dayOfWeek === 0 || dayOfWeek === 6);
        const dayItems     = cpMap[dateStr] || [];

        let classes = 'checkpoint-cal-day';
        if (isToday)                    classes += ' today';
        if (isOtherMonth)               classes += ' other-month';
        if (isWeekend && !isToday)      classes += ' weekend';

        html += `<div class="${classes}">`;
        html += `<div class="checkpoint-cal-day-number">${d.getDate()}</div>`;
        dayItems.forEach(cp => {
            html += `<div class="checkpoint-cal-item" title="${escapeHtml(cp.client)} — ${escapeHtml(cp.code)}\n${escapeHtml(cp.description)}">
                <div class="cp-client">${escapeHtml(cp.client)}</div>
                <div class="cp-project">${escapeHtml(cp.code)}</div>
                <div class="cp-name">🚩 ${escapeHtml(cp.name)}</div>
            </div>`;
        });
        html += '</div>';
    }

    html += '</div>';
    html += renderCheckpointList(checkpoints, firstDay, lastDay);
    html += '</div>';

    container.innerHTML = html;
}

// ─── Esportazioni ─────────────────────────────────────────────────────────────

export function renderCheckpointCalendar() {
    const container = document.getElementById('checkpointCalendarContainer');
    if (!container) return;

    const view         = document.getElementById('checkpointCalendarView')?.value || 'month';
    const filterClient = (document.getElementById('checkpointFilterClient')?.value || '').toLowerCase();
    const label        = document.getElementById('checkpointCalendarLabel');

    let allCheckpoints = getAllCheckpoints();
    if (filterClient) {
        allCheckpoints = allCheckpoints.filter(cp =>
            (cp.client || '').toLowerCase().includes(filterClient)
        );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = formatDateLocal(today);

    if (view === 'week') {
        renderWeekView(container, allCheckpoints, today, label, todayStr);
    } else {
        renderMonthView(container, allCheckpoints, today, label, todayStr);
    }
}

/** Naviga al periodo precedente (mese o settimana). */
export function checkpointCalPrev() {
    _checkpointOffset -= 1;
    renderCheckpointCalendar();
}

/** Naviga al periodo successivo (mese o settimana). */
export function checkpointCalNext() {
    _checkpointOffset += 1;
    renderCheckpointCalendar();
}

/** Torna al periodo corrente. */
export function checkpointCalToday() {
    _checkpointOffset = 0;
    renderCheckpointCalendar();
}
