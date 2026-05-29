/**
 * js/helpers.js  –  Funzioni di utilità condivise
 *
 * Contiene:
 *  - Helper pure (nessuna dipendenza da stato)
 *  - Helper che leggono lo stato globale (importano da state.js)
 *
 * Tutte le funzioni sono esportate. Non contengono logica UI.
 */

import { resources, plants, holidays } from './state.js';

// ─── Formattazione date ────────────────────────────────────────────────────────

/**
 * Formato YYYY-MM-DD da un oggetto Date, senza problemi di timezone.
 * Usa i metodi locali (getFullYear, getMonth, getDate).
 */
export function formatDateLocal(date) {
  const year  = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day   = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parsa una stringa "YYYY-MM-DD" in un oggetto Date locale (senza UTC shift). */
export function parseDateLocal(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ─── HTML escape ──────────────────────────────────────────────────────────────

/** Escape di caratteri HTML per prevenire XSS. */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

// ─── Durate e orari ───────────────────────────────────────────────────────────

/** Converte ore decimali (es. 1.5) in formato "hh:mm" (es. "01:30"). */
export function hoursToHHMM(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** Converte una durata ("hh:mm" o ore decimali) in minuti. */
export function parseDurationToMinutes(duration) {
  if (typeof duration === 'number') return duration * 60;
  if (typeof duration === 'string' && duration.includes(':')) {
    const [h, m] = duration.split(':').map(Number);
    return h * 60 + m;
  }
  return parseFloat(duration) * 60 || 0;
}

// ─── ID generation ────────────────────────────────────────────────────────────

/** Genera un ID numerico univoco (compatibile con la v1). */
export function generateId() {
  return Date.now() + Math.floor(Math.random() * 10000);
}

// ─── Risorse ──────────────────────────────────────────────────────────────────

/** Ritorna il nome completo di una risorsa dato il suo id. */
export function getResourceName(resourceId) {
  const r = resources.find(r => r.id == resourceId);
  if (!r) return 'Sconosciuto';
  const fullName = `${r.firstName || ''} ${r.lastName || ''}`.trim();
  return fullName || 'Sconosciuto';
}

// ─── Clienti ──────────────────────────────────────────────────────────────────

/** Ritorna tutti i clienti unici (da progetti e stabilimenti), ordinati. */
export function getAllUniqueClients(projectsArr = [], plantsArr = plants) {
  const fromProjects = projectsArr.map(p => p.client).filter(Boolean);
  const fromPlants   = plantsArr.map(p => p.client).filter(Boolean);
  return [...new Set([...fromProjects, ...fromPlants])].sort();
}

// ─── Location badge ───────────────────────────────────────────────────────────

/** Ritorna l'HTML del badge di localizzazione per un task. */
export function getLocationBadgeHtml(task) {
  const type   = task.locationType || 'sede';
  const icons  = { sede: '🏢', cliente: '🏭', remoto: '📡' };
  const titles = { sede: 'Sede', cliente: 'Cliente', remoto: 'Remoto' };
  let label = icons[type]  || icons.sede;
  let title = titles[type] || titles.sede;

  if (type === 'cliente' && task.plantId) {
    const plant = plants.find(p => p.id == task.plantId);
    if (plant) {
      label += ` ${plant.name}`;
      title += ` - ${plant.name}`;
    }
  }
  return `<span class="location-badge ${type}" title="${title}">${label}</span>`;
}

// ─── Assenze ──────────────────────────────────────────────────────────────────

/**
 * Ritorna true se TUTTE le risorse del task sono assenti in una data specifica.
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {Array} taskResources - array di {resourceId, ...}
 */
export function areAllResourcesAbsent(dateStr, taskResources) {
  if (!taskResources || taskResources.length === 0) return false;

  const checkDate = new Date(dateStr);
  checkDate.setHours(0, 0, 0, 0);

  return taskResources.every(tr => {
    const resource = resources.find(r => r.id == tr.resourceId);
    if (!resource || !resource.absences) return false;

    return resource.absences.some(absence => {
      const absStart = new Date(absence.start);
      const absEnd   = new Date(absence.end);
      absStart.setHours(0, 0, 0, 0);
      absEnd.setHours(0, 0, 0, 0);
      return checkDate >= absStart && checkDate <= absEnd;
    });
  });
}

/**
 * Ritorna true se ALMENO UNA risorsa è assente in una data specifica.
 */
export function hasAnyResourceAbsent(dateStr, taskResources) {
  if (!taskResources || taskResources.length === 0) return false;

  const checkDate = new Date(dateStr);
  checkDate.setHours(0, 0, 0, 0);

  return taskResources.some(tr => {
    const resource = resources.find(r => r.id == tr.resourceId);
    if (!resource || !resource.absences) return false;

    return resource.absences.some(absence => {
      const absStart = new Date(absence.start);
      const absEnd   = new Date(absence.end);
      absStart.setHours(0, 0, 0, 0);
      absEnd.setHours(0, 0, 0, 0);
      return checkDate >= absStart && checkDate <= absEnd;
    });
  });
}

// ─── Calcolo giorni lavorativi ─────────────────────────────────────────────────

/**
 * Conta i giorni lavorativi tra due date (estremi inclusi).
 * Usa l'array globale `holidays` per i festivi.
 */
export function countWorkingDaysBetween(
  startDateStr, endDateStr,
  saturdayWork = false, sundayWork = false, holidayWork = false,
  taskResources = null
) {
  const [y1, m1, d1] = startDateStr.split('-').map(Number);
  const [y2, m2, d2] = endDateStr.split('-').map(Number);
  const start   = new Date(y1, m1 - 1, d1);
  const end     = new Date(y2, m2 - 1, d2);
  let count     = 0;
  const current = new Date(start);

  while (current <= end) {
    const dow          = current.getDay();
    const dateStr      = formatDateLocal(current);
    const isHoliday    = holidays.some(h => h.date === dateStr);
    const isSaturday   = dow === 6;
    const isSunday     = dow === 0;
    const isWorkingDay = (!isHoliday || holidayWork)
                      && (!isSaturday || saturdayWork)
                      && (!isSunday   || sundayWork);

    if (isWorkingDay) {
      if (taskResources && taskResources.length > 0 && areAllResourcesAbsent(dateStr, taskResources)) {
        current.setDate(current.getDate() + 1);
        continue;
      }
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/**
 * Calcola la data di fine da una data di inizio + durata in giorni lavorativi.
 * Rispetta weekend, festivi e assenze delle risorse.
 */
export function calculateEndDateForTask(
  startDateStr, duration,
  saturdayWork = false, sundayWork = false, holidayWork = false,
  taskResources = null
) {
  const [y, m, d] = startDateStr.split('-').map(Number);
  const date      = new Date(y, m - 1, d);
  let workDaysAdded = 0;

  while (workDaysAdded < duration) {
    const dow       = date.getDay();
    const dateStr   = formatDateLocal(date);
    const isHoliday = holidays.some(h => h.date === dateStr);

    const isWorkingDay = (!isHoliday || holidayWork)
                      && (dow !== 6 || saturdayWork)
                      && (dow !== 0 || sundayWork)
                      && !areAllResourcesAbsent(dateStr, taskResources);

    if (isWorkingDay) {
      workDaysAdded++;
      if (workDaysAdded === duration) break;
    }
    date.setDate(date.getDate() + 1);
  }
  return formatDateLocal(date);
}

/**
 * Calcola la data di inizio da una data di fine + durata (a ritroso).
 */
export function calculateStartDateForTask(
  endDateStr, duration,
  saturdayWork = false, sundayWork = false, holidayWork = false,
  taskResources = null
) {
  const [y, m, d] = endDateStr.split('-').map(Number);
  const date      = new Date(y, m - 1, d);
  let workDaysAdded = 0;

  while (workDaysAdded < duration) {
    const dow       = date.getDay();
    const dateStr   = formatDateLocal(date);
    const isHoliday = holidays.some(h => h.date === dateStr);

    const isWorkingDay = (!isHoliday || holidayWork)
                      && (dow !== 6 || saturdayWork)
                      && (dow !== 0 || sundayWork)
                      && !areAllResourcesAbsent(dateStr, taskResources);

    if (isWorkingDay) {
      workDaysAdded++;
      if (workDaysAdded === duration) break;
    }
    date.setDate(date.getDate() - 1);
  }
  return formatDateLocal(date);
}

/**
 * Avanza una data di N giorni lavorativi (positivo = avanti, negativo = indietro).
 */
export function calculateDateWithOffset(
  dateStr, offsetDays,
  saturdayWork = false, sundayWork = false, holidayWork = false,
  taskResources = null
) {
  if (offsetDays === 0) return dateStr;

  const [y, m, d] = dateStr.split('-').map(Number);
  const date      = new Date(y, m - 1, d);
  const direction = offsetDays > 0 ? 1 : -1;
  const totalDays = Math.abs(offsetDays);
  let workDaysAdded = 0;

  while (workDaysAdded < totalDays) {
    date.setDate(date.getDate() + direction);

    const dow       = date.getDay();
    const dStr      = formatDateLocal(date);
    const isHoliday = holidays.some(h => h.date === dStr);

    const isWorkingDay = (!isHoliday || holidayWork)
                      && (dow !== 6 || saturdayWork)
                      && (dow !== 0 || sundayWork)
                      && !areAllResourcesAbsent(dStr, taskResources);

    if (isWorkingDay) workDaysAdded++;
  }
  return formatDateLocal(date);
}

/** Ritorna il prossimo giorno lavorativo dopo una data. */
export function calculateNextWorkingDay(dateStr, saturdayWork, sundayWork, holidayWork = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date      = new Date(y, m - 1, d);
  date.setDate(date.getDate() + 1);

  while (true) {
    const dow       = date.getDay();
    const dStr      = formatDateLocal(date);
    const isHoliday = holidays.some(h => h.date === dStr);
    const isWorkingDay = (!isHoliday || holidayWork)
                      && (dow !== 6 || saturdayWork)
                      && (dow !== 0 || sundayWork);
    if (isWorkingDay) break;
    date.setDate(date.getDate() + 1);
  }
  return formatDateLocal(date);
}

// ─── Modal helpers ─────────────────────────────────────────────────────────────

/**
 * Applica la modalità sola lettura completa a un modal per gli utenti viewer.
 * Disabilita tutti gli input e nasconde i pulsanti di azione.
 */
function _applyViewerModalRestrictions(modal) {
  modal.querySelectorAll('input, select, textarea').forEach(el => {
    el.disabled = true;
  });
  modal.querySelectorAll('button').forEach(btn => {
    const onclick = (btn.getAttribute('onclick') || '').trim();
    const isClose = btn.classList.contains('modal-close') || /^close/i.test(onclick);
    if (!isClose) btn.style.display = 'none';
  });
  // Banner sola lettura
  const footer = modal.querySelector('.modal-footer');
  if (footer && !footer.querySelector('.pp2-viewer-notice')) {
    const notice = document.createElement('span');
    notice.className = 'pp2-viewer-notice';
    notice.style.cssText = 'font-size:12px;color:var(--text-secondary,#666);margin-right:auto;';
    notice.textContent = '👁️ Modalità sola lettura';
    footer.prepend(notice);
  }
}

export function openModal(modalElement) {
  if (modalElement) {
    modalElement.classList.add('active');
    document.body.classList.add('modal-open');
    // Sola lettura: viewer globale o modal esplicitamente marcato read-only (es. editor su tipo non consentito)
    if (document.body.dataset.userRole === 'viewer' || modalElement.dataset.readOnly === 'true') {
      _applyViewerModalRestrictions(modalElement);
    }
  }
}

export function closeModal(modalElement) {
  if (modalElement) {
    modalElement.classList.remove('active');
    document.body.classList.remove('modal-open');
  }
}
