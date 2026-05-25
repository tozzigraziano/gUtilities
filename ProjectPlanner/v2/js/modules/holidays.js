/**
 * js/modules/holidays.js
 *
 * Gestione festività nazionali italiane e festività locali personalizzate.
 */
import * as db from '../db.js';
import * as state from '../state.js';
import { openModal, closeModal } from '../helpers.js';

// ─── Festività nazionali ──────────────────────────────────────────────────────

/**
 * Restituisce le festività nazionali italiane per un dato anno,
 * inclusa Pasqua e Pasquetta calcolate con l'algoritmo di Gauss.
 * @param {number} year
 * @returns {{ date: string, name: string }[]}
 */
export function getItalianHolidays(year) {
    const holidays = [];

    // Festività fisse
    holidays.push({ date: `${year}-01-01`, name: 'Capodanno' });
    holidays.push({ date: `${year}-01-06`, name: 'Epifania' });
    holidays.push({ date: `${year}-04-25`, name: 'Festa della Liberazione' });
    holidays.push({ date: `${year}-05-01`, name: 'Festa dei Lavoratori' });
    holidays.push({ date: `${year}-06-02`, name: 'Festa della Repubblica' });
    holidays.push({ date: `${year}-08-15`, name: 'Ferragosto' });
    holidays.push({ date: `${year}-11-01`, name: 'Tutti i Santi' });
    holidays.push({ date: `${year}-12-08`, name: 'Immacolata Concezione' });
    holidays.push({ date: `${year}-12-25`, name: 'Natale' });
    holidays.push({ date: `${year}-12-26`, name: 'Santo Stefano' });

    // Calcolo Pasqua (algoritmo di Gauss)
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    // Usa formato locale invece di ISO per evitare problemi di timezone
    const easterMonth = String(month).padStart(2, '0');
    const easterDay = String(day).padStart(2, '0');
    const easterDate = `${year}-${easterMonth}-${easterDay}`;

    holidays.push({ date: easterDate, name: 'Pasqua' });

    // Lunedì dell'Angelo (Pasquetta) - aggiungi 1 giorno
    const easter = new Date(year, month - 1, day);
    const easterMonday = new Date(easter);
    easterMonday.setDate(easter.getDate() + 1);
    const mondayMonth = String(easterMonday.getMonth() + 1).padStart(2, '0');
    const mondayDay = String(easterMonday.getDate()).padStart(2, '0');
    const mondayDate = `${easterMonday.getFullYear()}-${mondayMonth}-${mondayDay}`;

    holidays.push({ date: mondayDate, name: "Lunedì dell'Angelo" });

    return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Calcolo festività ────────────────────────────────────────────────────────

/**
 * Ricalcola l'array globale delle festività in base al range di anni
 * coperto dai progetti correnti, includendo le festività locali.
 * Aggiorna state.holidays tramite state.setHolidays().
 */
export function calculateHolidays() {
    // Trova il range di anni necessario dai progetti
    let minYear = new Date().getFullYear();
    let maxYear = minYear;

    state.projects.forEach(project => {
        if (project.milestones) {
            project.milestones.forEach(m => {
                if (m.date) {
                    const year = new Date(m.date).getFullYear();
                    if (year < minYear) minYear = year;
                    if (year > maxYear) maxYear = year;
                }
            });
        }
        if (project.tasks) {
            project.tasks.forEach(t => {
                if (t.startDate) {
                    const year = new Date(t.startDate).getFullYear();
                    if (year < minYear) minYear = year;
                    if (year > maxYear) maxYear = year;
                }
                if (t.endDate) {
                    const year = new Date(t.endDate).getFullYear();
                    if (year < minYear) minYear = year;
                    if (year > maxYear) maxYear = year;
                }
            });
        }
    });

    // Genera festività per tutti gli anni nel range
    let computed = [];
    for (let year = minYear; year <= maxYear; year++) {
        computed = computed.concat(getItalianHolidays(year));

        // Aggiungi festività locali per questo anno
        state.localHolidays.forEach(lh => {
            const month = lh.month.toString().padStart(2, '0');
            const day = lh.day.toString().padStart(2, '0');
            computed.push({
                date: `${year}-${month}-${day}`,
                name: lh.name
            });
        });
    }

    computed.sort((a, b) => a.date.localeCompare(b.date));
    state.setHolidays(computed);
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Aggiorna la tabella #holidaysTable con le festività calcolate.
 */
export function renderHolidays() {
    const tbody = document.querySelector('#holidaysTable tbody');
    tbody.innerHTML = '';

    state.holidays.forEach(holiday => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${holiday.date}</td>
            <td>${holiday.name}</td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Aggiorna la tabella #localHolidaysTable con le festività locali.
 */
export function renderLocalHolidays() {
    const tbody = document.querySelector('#localHolidaysTable tbody');
    tbody.innerHTML = '';

    state.localHolidays.forEach(holiday => {
        const tr = document.createElement('tr');
        const monthNames = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
        tr.innerHTML = `
            <td>${holiday.name}</td>
            <td>${holiday.day} ${monthNames[holiday.month - 1]}</td>
            <td class="action-buttons">
                <button onclick="openLocalHolidayModal(${holiday.id})" class="secondary">✏️ Modifica</button>
                <button onclick="deleteLocalHoliday(${holiday.id})" class="delete">🗑️ Elimina</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ─── Modale festività locale ──────────────────────────────────────────────────

/**
 * Apre il modale per creare o modificare una festività locale.
 * @param {number|null} id - id della festività da modificare, null per nuova
 */
export function openLocalHolidayModal(id = null) {
    state.setEditingLocalHolidayId(id);
    const modal = document.getElementById('localHolidayModal');
    const title = document.getElementById('localHolidayModalTitle');

    if (id) {
        title.textContent = 'Modifica Festività Locale';
        const holiday = state.localHolidays.find(h => h.id === id);
        if (holiday) {
            document.getElementById('localHolidayName').value = holiday.name;
            document.getElementById('localHolidayDay').value = holiday.day;
            document.getElementById('localHolidayMonth').value = holiday.month;
        }
    } else {
        title.textContent = 'Nuova Festività Locale';
        clearLocalHolidayForm();
    }

    openModal(modal);
}

/**
 * Chiude il modale festività locale e resetta il form.
 */
export function closeLocalHolidayModal() {
    closeModal(document.getElementById('localHolidayModal'));
    clearLocalHolidayForm();
}

// ─── CRUD festività locale ────────────────────────────────────────────────────

/**
 * Salva (crea o aggiorna) la festività locale dal form corrente.
 * Persiste il singolo item su IndexedDB tramite db.save().
 */
export async function saveLocalHoliday() {
    const name = document.getElementById('localHolidayName').value.trim();
    const day = parseInt(document.getElementById('localHolidayDay').value);
    const month = parseInt(document.getElementById('localHolidayMonth').value);

    if (!name || !day || !month) {
        alert('Tutti i campi sono obbligatori');
        return;
    }

    if (day < 1 || day > 31) {
        alert('Giorno non valido');
        return;
    }

    const localHoliday = {
        id: state.editingLocalHolidayId || Date.now(),
        name,
        day,
        month
    };

    if (state.editingLocalHolidayId) {
        const updated = state.localHolidays.map(h =>
            h.id === state.editingLocalHolidayId ? localHoliday : h
        );
        state.setLocalHolidays(updated);
    } else {
        state.setLocalHolidays([...state.localHolidays, localHoliday]);
    }

    await db.save('localHolidays', localHoliday);
    calculateHolidays();
    renderLocalHolidays();
    renderHolidays();
    closeLocalHolidayModal();
}

/**
 * Popola il form con i dati della festività locale da modificare.
 * @param {number} id
 */
export function editLocalHoliday(id) {
    const holiday = state.localHolidays.find(h => h.id === id);
    if (!holiday) return;

    state.setEditingLocalHolidayId(id);
    document.getElementById('localHolidayName').value = holiday.name;
    document.getElementById('localHolidayDay').value = holiday.day;
    document.getElementById('localHolidayMonth').value = holiday.month;

    document.getElementById('localHolidayName').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Elimina una festività locale dopo conferma utente.
 * Rimuove il record da IndexedDB tramite db.remove().
 * @param {number} id
 */
export async function deleteLocalHoliday(id) {
    if (!confirm('Sei sicuro di voler eliminare questa festività locale?')) return;
    state.setLocalHolidays(state.localHolidays.filter(h => h.id !== id));
    await db.remove('localHolidays', id);
    calculateHolidays();
    renderLocalHolidays();
    renderHolidays();
}

/**
 * Resetta il form festività locale e azzera l'id di editing.
 */
export function clearLocalHolidayForm() {
    state.setEditingLocalHolidayId(null);
    document.getElementById('localHolidayName').value = '';
    document.getElementById('localHolidayDay').value = '';
    document.getElementById('localHolidayMonth').value = '1';
}

