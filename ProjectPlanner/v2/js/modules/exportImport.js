/**
 * js/modules/exportImport.js
 *
 * Gestione Export / Import dati in formato JSON.
 *
 * - exportData()        → chiama db.exportData() (backend o IDB cache), poi download file
 * - importData()        → legge file #importFile, chiama db.importData(), ricarica pagina
 * - importDataMerge()   → legge file #importFile, chiama db.importMerge(), ricarica pagina
 *
 * Formato JSON compatibile con v1 (ProjectPlanner/index.html):
 * {
 *   exportDate, version,
 *   resources, projects, templates, meetings, plants, localHolidays,
 *   settings, quickNotes (opzionale)
 * }
 *
 * Dipendenze v2:
 *   - ../db.js        → db.exportData, db.importData, db.importMerge
 *   - ../state.js     → state.quickNotes
 *   - ../helpers.js   → formatDateLocal
 */

import * as db    from '../db.js';
import * as state from '../state.js';
import * as Auth  from './auth.js';
import { formatDateLocal } from '../helpers.js';

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Esporta tutti i dati in un file JSON scaricabile.
 * Online:  recupera il payload dal backend (/api/export)
 * Offline: costruisce il payload dalla cache IDB
 * In entrambi i casi, aggiunge quickNotes dallo state se presenti.
 */
export async function exportData() {
    try {
        const payload = await db.exportData();

        // Aggiungi quickNotes dallo state (non gestiti dal backend come store separato)
        if (state.quickNotes && state.quickNotes.length > 0) {
            payload.quickNotes = state.quickNotes;
        }

        const dataStr = JSON.stringify(payload, null, 2);
        const blob    = new Blob([dataStr], { type: 'application/json' });
        const url     = URL.createObjectURL(blob);

        const link      = document.createElement('a');
        link.href       = url;
        link.download   = `project-planner-export-${formatDateLocal(new Date())}.json`;
        link.click();

        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Errore durante l\'esportazione: ' + err.message);
    }
}

// ─── Import (full replace) ────────────────────────────────────────────────────

/**
 * Importa un file JSON sostituendo TUTTI i dati esistenti.
 * Legge il file dall'input #importFile.
 * Dopo l'import, ricarica la pagina per aggiornare lo stato.
 */
export async function importData() {
    if (Auth.getCurrentUser()?.role !== 'admin') {
        alert('Operazione riservata agli amministratori.');
        return;
    }

    const fileInput = document.getElementById('importFile');
    const file      = fileInput?.files[0];

    if (!file) {
        alert('Seleziona un file da importare');
        return;
    }

    if (!confirm('Questo sostituirà TUTTI i dati correnti. Sei sicuro?')) return;

    try {
        const text    = await file.text();
        const payload = JSON.parse(text);

        await db.importData(payload);

        alert('Dati importati con successo!');
        fileInput.value = '';
        window.location.reload();
    } catch (err) {
        alert('Errore nell\'importazione: ' + err.message);
    }
}

// ─── Import con merge ─────────────────────────────────────────────────────────

/**
 * Importa un file JSON aggiungendo i dati senza sovrascrivere quelli esistenti
 * (solo id non presenti vengono aggiunti).
 * Legge il file dall'input #importFile.
 * Dopo l'import, ricarica la pagina per aggiornare lo stato.
 */
export async function importDataMerge() {
    if (Auth.getCurrentUser()?.role !== 'admin') {
        alert('Operazione riservata agli amministratori.');
        return;
    }

    const fileInput = document.getElementById('importFile');
    const file      = fileInput?.files[0];

    if (!file) {
        alert('Seleziona un file da importare');
        return;
    }

    try {
        const text    = await file.text();
        const payload = JSON.parse(text);

        await db.importMerge(payload);

        alert('Dati uniti con successo!');
        fileInput.value = '';
        window.location.reload();
    } catch (err) {
        alert('Errore nell\'importazione: ' + err.message);
    }
}

// ─── Wipe database ────────────────────────────────────────────────────────────

/**
 * Cancella l'intero database (tutte le tabelle dati, impostazioni e cache IDB).
 * Riservata all'admin. Richiede doppia conferma.
 */
export async function wipeDatabase() {
    if (Auth.getCurrentUser()?.role !== 'admin') {
        alert('Operazione riservata agli amministratori.');
        return;
    }
    if (!confirm('⚠️ ATTENZIONE: questa operazione eliminerà TUTTI i dati (risorse, progetti, template, riunioni, festività, impostazioni).\n\nQuesto è IRREVERSIBILE. Continuare?')) return;
    if (!confirm('Conferma definitiva: eliminare TUTTO il contenuto del database?')) return;
    try {
        await db.wipeAll();
        alert('Database pulito con successo.');
        window.location.reload();
    } catch (err) {
        alert('Errore durante la pulizia del database: ' + err.message);
    }
}
