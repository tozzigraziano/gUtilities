/**
 * js/modules/offers.js
 *
 * Gestione Offerte e Issue (segnalazioni/problemi) dei progetti.
 *
 * Le offerte e le issue sono array annidati dentro ogni progetto:
 *   project.offers[]  → preventivi/offerte commerciali
 *   project.issues[]  → segnalazioni di problemi/rischi
 *
 * Funzioni esportate:
 *   Offerte:
 *     renderOffersOverview()          → tab globale "Offerte" (tutte le offerte di tutti i progetti)
 *     renderProjectOffers()           → sezione offerte nel dettaglio di un progetto
 *     openOfferModal(id, viewOnly, projectId)
 *     closeOfferModal()
 *     saveOffer()
 *     editOffer(index)
 *     viewOffer(index)
 *     deleteOffer(index)
 *     clearOfferFilters()
 *   Issue:
 *     renderProjectIssues()           → sezione issue nel dettaglio di un progetto
 *     openIssueModal(id, viewOnly)
 *     closeIssueModal()
 *     saveIssue()
 *     editIssue(index)
 *     viewIssue(index)
 *     deleteIssue(index)
 *
 * Persistenza:
 *   Le offerte/issue fanno parte dell'oggetto progetto. Dopo ogni modifica:
 *     await db.save('projects', project)
 *
 * Dipendenze v2:
 *   - ../db.js        → db.save
 *   - ../state.js     → state.projects, state.currentProjectId, state.resources
 *   - ../helpers.js   → escapeHtml, formatDateLocal, getResourceName
 */

import * as db    from '../db.js';
import * as state from '../state.js';
import { escapeHtml, formatDateLocal, getResourceName } from '../helpers.js';

// ─── Stato modulo ─────────────────────────────────────────────────────────────

let _editingOfferId        = null;   // indice nell'array project.offers, o null se nuova
let _editingOfferProjectId = null;   // id del progetto proprietario dell'offerta
let _editingIssueId        = null;   // indice nell'array project.issues, o null se nuovo

// ─── Costanti UI ─────────────────────────────────────────────────────────────

const OFFER_STATUS_COLORS = {
    'in-preparazione': '#999',
    'inviata':         '#2196F3',
    'accettata':       '#4CAF50',
    'rifiutata':       '#f44336'
};

const OFFER_STATUS_LABELS = {
    'in-preparazione': '📝 In Preparazione',
    'inviata':         '📤 Inviata',
    'accettata':       '✅ Accettata',
    'rifiutata':       '❌ Rifiutata'
};

const ISSUE_PRIORITY_COLORS = {
    'bassa':   '#4CAF50',
    'media':   '#FFC107',
    'alta':    '#FF9800',
    'critica': '#f44336'
};

const ISSUE_PRIORITY_ICONS = {
    'bassa':   '🟢',
    'media':   '🟡',
    'alta':    '🟠',
    'critica': '🔴'
};

const ISSUE_STATUS_COLORS = {
    'aperto':       '#2196F3',
    'in-lavorazione': '#FF9800',
    'risolto':      '#4CAF50',
    'chiuso':       '#999'
};

// ─── Helper interno ───────────────────────────────────────────────────────────

/** Notifica le viste dipendenti di aggiornarsi. */
function _triggerViewRefresh(views = []) {
    window.dispatchEvent(new CustomEvent('app:viewRefresh', { detail: { views } }));
}

/** Ritorna il progetto corrente (identificato da state.currentProjectId). */
function _currentProject() {
    return state.projects.find(p => p.id === state.currentProjectId) || null;
}

// ─── OFFERTE – Tab panoramica globale ─────────────────────────────────────────

/**
 * Renderizza la tabella globale di tutte le offerte (tab "Offerte").
 * Include filtri per stato, cliente, codice progetto, codice offerta e titolo.
 */
export function renderOffersOverview() {
    const tbody = document.querySelector('#offersOverviewTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filterStatus      = document.getElementById('offerFilterStatus')?.value || '';
    const filterClient      = (document.getElementById('offerFilterClient')?.value || '').toLowerCase();
    const filterProjectCode = (document.getElementById('offerFilterProjectCode')?.value || '').toLowerCase();
    const filterCode        = (document.getElementById('offerFilterCode')?.value || '').toLowerCase();
    const filterTitle       = (document.getElementById('offerFilterTitle')?.value || '').toLowerCase();

    // Raccogli tutte le offerte da tutti i progetti
    let allOffers = [];
    state.projects.forEach(project => {
        if (project.offers && project.offers.length > 0) {
            project.offers.forEach((offer, offerIndex) => {
                allOffers.push({ offer, project, offerIndex });
            });
        }
    });

    // Applica filtri
    let filtered = allOffers;
    if (filterStatus)      filtered = filtered.filter(item => item.offer.status === filterStatus);
    if (filterClient)      filtered = filtered.filter(item => (item.project.client || '').toLowerCase().includes(filterClient));
    if (filterProjectCode) filtered = filtered.filter(item => (item.project.code || '').toLowerCase().includes(filterProjectCode));
    if (filterCode)        filtered = filtered.filter(item => (item.offer.offerCode || '').toLowerCase().includes(filterCode));
    if (filterTitle)       filtered = filtered.filter(item => (item.offer.title || '').toLowerCase().includes(filterTitle));

    // Ordina per data decrescente
    filtered.sort((a, b) => new Date(b.offer.date) - new Date(a.offer.date));

    // Renderizza righe
    filtered.forEach(item => {
        const row   = tbody.insertRow();
        const value = item.offer.value ? `€ ${parseFloat(item.offer.value).toFixed(2)}` : '-';

        row.style.cursor = 'pointer';
        row.onclick = function (e) {
            if (e.target.tagName !== 'BUTTON') {
                openOfferModal(item.offerIndex, true, item.project.id);
            }
        };

        row.innerHTML = `
            <td>${escapeHtml(item.project.client || '-')}</td>
            <td>${escapeHtml(item.project.code || '-')}</td>
            <td>${escapeHtml(item.offer.offerCode || '-')}</td>
            <td>${escapeHtml(item.offer.title)}</td>
            <td>${formatDateLocal(new Date(item.offer.date))}</td>
            <td>${escapeHtml(item.offer.estimate)}</td>
            <td style="text-align:right;">${value}</td>
            <td><span style="color:${OFFER_STATUS_COLORS[item.offer.status]}">${OFFER_STATUS_LABELS[item.offer.status]}</span></td>
            <td>
                <button onclick="event.stopPropagation(); offers.openOfferModal(${item.offerIndex}, false, '${item.project.id}')"
                    title="Modifica" style="padding:4px 8px; font-size:12px;">✏️</button>
            </td>
        `;
    });

    if (filtered.length === 0) {
        const row = tbody.insertRow();
        row.innerHTML = '<td colspan="9" style="text-align:center; color:var(--text-tertiary); font-style:italic;">Nessuna offerta trovata</td>';
    }

    // Riga totale
    const totalValue = filtered.reduce((sum, item) => sum + (item.offer.value ? parseFloat(item.offer.value) : 0), 0);
    const summaryRow = tbody.insertRow();
    summaryRow.style.fontWeight        = 'bold';
    summaryRow.style.backgroundColor   = 'var(--bg-tertiary)';
    summaryRow.innerHTML = `
        <td colspan="6" style="text-align:right;">Totale Offerte: ${filtered.length}</td>
        <td style="text-align:right;">€ ${totalValue.toFixed(2)}</td>
        <td colspan="2"></td>
    `;
}

/** Pulisce tutti i filtri della tab Offerte e rieffettua il rendering. */
export function clearOfferFilters() {
    const ids = ['offerFilterStatus', 'offerFilterClient', 'offerFilterProjectCode', 'offerFilterCode', 'offerFilterTitle'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    renderOffersOverview();
}

// ─── OFFERTE – Dettaglio progetto ─────────────────────────────────────────────

/**
 * Renderizza la tabella offerte nel dettaglio del progetto corrente.
 */
export function renderProjectOffers() {
    const project = _currentProject();
    if (!project) return;

    const tbody = document.querySelector('#projectOffersTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const offers = project.offers || [];

    offers.forEach((offer, index) => {
        const row   = tbody.insertRow();
        const value = offer.value ? `€ ${parseFloat(offer.value).toFixed(2)}` : '-';

        row.style.cursor = 'pointer';
        row.onclick = function (e) {
            if (e.target.tagName !== 'BUTTON') viewOffer(index);
        };

        row.innerHTML = `
            <td>${escapeHtml(offer.offerCode || '-')}</td>
            <td>${escapeHtml(offer.title)}</td>
            <td>${formatDateLocal(new Date(offer.date))}</td>
            <td>${escapeHtml(offer.estimate)}</td>
            <td>${value}</td>
            <td><span style="color:${OFFER_STATUS_COLORS[offer.status]}">${OFFER_STATUS_LABELS[offer.status]}</span></td>
            <td>
                <button onclick="event.stopPropagation(); offers.editOffer(${index})"
                    title="Modifica" style="padding:4px 8px; font-size:12px;">✏️</button>
                <button onclick="event.stopPropagation(); offers.deleteOffer(${index})"
                    title="Elimina" style="padding:4px 8px; font-size:12px;">🗑️</button>
            </td>
        `;
    });

    if (offers.length === 0) {
        const row = tbody.insertRow();
        row.innerHTML = '<td colspan="7" style="text-align:center; color:var(--text-tertiary); font-style:italic;">Nessuna offerta presente</td>';
    }
}

// ─── OFFERTE – Modal ──────────────────────────────────────────────────────────

/**
 * Apre il modal offerta.
 * @param {number|null} id         - indice nell'array project.offers, null per nuova offerta
 * @param {boolean}     viewOnly   - se true, tutti i campi sono disabilitati (sola lettura)
 * @param {*}           projectId  - id del progetto proprietario (opzionale, default: currentProjectId)
 */
export function openOfferModal(id = null, viewOnly = false, projectId = null) {
    _editingOfferId        = id;
    _editingOfferProjectId = projectId || state.currentProjectId;

    const modal = document.getElementById('offerModal');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.classList.add('modal-open');

    const isViewOnly = viewOnly === true;
    const fields = ['offerCode', 'offerTitle', 'offerDate', 'offerEstimate', 'offerValue', 'offerStatus', 'offerNotes'];
    fields.forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if (el) el.disabled = isViewOnly;
    });

    // Nascondi pulsante salva in modalità sola lettura
    const saveBtn = document.querySelector('#offerModal .modal-footer button:last-child');
    if (saveBtn) saveBtn.style.display = isViewOnly ? 'none' : 'inline-block';

    if (id !== null) {
        const project = state.projects.find(p => p.id === _editingOfferProjectId);
        if (!project || !project.offers) return;
        const offer = project.offers[id];

        document.getElementById('offerModalTitle').textContent = isViewOnly ? '💼 Visualizza Offerta' : '💼 Modifica Offerta';
        document.getElementById('offerCode').value     = offer.offerCode || '';
        document.getElementById('offerTitle').value    = offer.title;
        document.getElementById('offerDate').value     = offer.date;
        document.getElementById('offerEstimate').value = offer.estimate;
        document.getElementById('offerValue').value    = offer.value || '';
        document.getElementById('offerStatus').value   = offer.status;
        document.getElementById('offerNotes').value    = offer.notes || '';
    } else {
        document.getElementById('offerModalTitle').textContent = '💼 Nuova Offerta';
        document.getElementById('offerCode').value     = '';
        document.getElementById('offerTitle').value    = '';
        document.getElementById('offerDate').value     = formatDateLocal(new Date());
        document.getElementById('offerEstimate').value = '';
        document.getElementById('offerValue').value    = '';
        document.getElementById('offerStatus').value   = 'in-preparazione';
        document.getElementById('offerNotes').value    = '';
    }

    // Inizializza editor markdown per le note (se disponibile)
    if (typeof createMarkdownEditor === 'function') {
        createMarkdownEditor('offerNotes', null, isViewOnly);
    }
}

/** Chiude il modal offerta e resetta lo stato del modulo. */
export function closeOfferModal() {
    const modal = document.getElementById('offerModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    _editingOfferId        = null;
    _editingOfferProjectId = null;
}

/**
 * Salva l'offerta corrente (nuova o modifica) raccogliendo i dati dal modal.
 * Persiste aggiornando il progetto parent.
 */
export async function saveOffer() {
    const projectId = _editingOfferProjectId || state.currentProjectId;
    const project   = state.projects.find(p => p.id === projectId);
    if (!project) return;

    const offerCode = document.getElementById('offerCode')?.value.trim() || '';
    const title     = document.getElementById('offerTitle')?.value.trim() || '';
    const date      = document.getElementById('offerDate')?.value || '';
    const estimate  = document.getElementById('offerEstimate')?.value.trim() || '';
    const value     = document.getElementById('offerValue')?.value || '';
    const status    = document.getElementById('offerStatus')?.value || '';
    const notes     = document.getElementById('offerNotes')?.value || '';

    if (!title || !date || !estimate || !status) {
        alert('⚠️ Compila tutti i campi obbligatori');
        return;
    }

    const offer = {
        offerCode,
        title,
        date,
        estimate,
        value:  value ? parseFloat(value) : null,
        status,
        notes
    };

    if (!project.offers) project.offers = [];

    if (_editingOfferId !== null) {
        project.offers[_editingOfferId] = offer;
    } else {
        project.offers.push(offer);
    }

    await db.save('projects', project);
    closeOfferModal();

    // Aggiorna le viste
    if (state.currentProjectId) renderProjectOffers();
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab && activeTab.id === 'offerte') renderOffersOverview();
}

/** Apre il modal in modalità modifica per l'offerta all'indice index. */
export function editOffer(index) {
    openOfferModal(index);
}

/** Apre il modal in sola lettura per l'offerta all'indice index. */
export function viewOffer(index) {
    openOfferModal(index, true);
}

/**
 * Elimina l'offerta all'indice index dal progetto corrente.
 * @param {number} index - indice nell'array project.offers
 */
export async function deleteOffer(index) {
    if (!confirm('Eliminare questa offerta?')) return;

    const project = _currentProject();
    if (!project || !project.offers) return;

    project.offers.splice(index, 1);
    await db.save('projects', project);
    renderProjectOffers();
}

// ─── ISSUE – Dettaglio progetto ───────────────────────────────────────────────

/**
 * Renderizza la tabella issue nel dettaglio del progetto corrente.
 */
export function renderProjectIssues() {
    const project = _currentProject();
    if (!project) return;

    const tbody = document.querySelector('#projectIssuesTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const issues = project.issues || [];

    issues.forEach((issue, index) => {
        const row    = tbody.insertRow();
        const date   = new Date(issue.createdAt);
        const assignee = issue.assignee ? getResourceName(issue.assignee) : 'Non assegnato';

        row.style.cursor = 'pointer';
        row.onclick = function (e) {
            if (e.target.tagName !== 'BUTTON') viewIssue(index);
        };

        const priority = issue.priority || 'media';
        const status   = issue.status   || 'aperto';

        row.innerHTML = `
            <td>${escapeHtml(issue.title)}</td>
            <td style="color:${ISSUE_PRIORITY_COLORS[priority]}">
                ${ISSUE_PRIORITY_ICONS[priority]} ${priority.charAt(0).toUpperCase() + priority.slice(1)}
            </td>
            <td>${escapeHtml(assignee)}</td>
            <td><span style="color:${ISSUE_STATUS_COLORS[status]}">
                ${status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ')}
            </span></td>
            <td>${date.toLocaleDateString('it-IT')}</td>
            <td>
                <button onclick="event.stopPropagation(); offers.editIssue(${index})"
                    title="Modifica" style="padding:4px 8px; font-size:12px;">✏️</button>
                <button onclick="event.stopPropagation(); offers.deleteIssue(${index})"
                    title="Elimina" style="padding:4px 8px; font-size:12px;">🗑️</button>
            </td>
        `;
    });

    if (issues.length === 0) {
        const row = tbody.insertRow();
        row.innerHTML = '<td colspan="6" style="text-align:center; color:var(--text-tertiary); font-style:italic;">Nessun issue presente</td>';
    }
}

// ─── ISSUE – Modal ────────────────────────────────────────────────────────────

/**
 * Apre il modal issue.
 * @param {number|null} id       - indice nell'array project.issues, null per nuovo issue
 * @param {boolean}     viewOnly - se true, campi disabilitati (sola lettura)
 */
export function openIssueModal(id = null, viewOnly = false) {
    _editingIssueId = id;

    const modal = document.getElementById('issueModal');
    if (!modal) return;
    modal.style.display = 'block';
    document.body.classList.add('modal-open');

    // Popola select assegnatario
    const select = document.getElementById('issueAssignee');
    if (select) {
        select.innerHTML = '<option value="">Non assegnato</option>';
        state.resources.forEach(r => {
            const fullName = `${r.firstName || ''} ${r.lastName || ''}`.trim();
            if (fullName) {
                select.innerHTML += `<option value="${r.id}">${escapeHtml(fullName)}</option>`;
            }
        });
    }

    const isViewOnly = viewOnly === true;
    const fields = ['issueTitle', 'issuePriority', 'issueAssignee', 'issueStatus', 'issueDescription'];
    fields.forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if (el) el.disabled = isViewOnly;
    });

    const saveBtn = document.querySelector('#issueModal .modal-footer button:last-child');
    if (saveBtn) saveBtn.style.display = isViewOnly ? 'none' : 'inline-block';

    if (id !== null) {
        const project = _currentProject();
        if (!project || !project.issues) return;
        const issue = project.issues[id];

        document.getElementById('issueModalTitle').textContent = isViewOnly ? '🐛 Visualizza Issue' : '🐛 Modifica Issue';
        document.getElementById('issueTitle').value       = issue.title;
        document.getElementById('issuePriority').value    = issue.priority;
        document.getElementById('issueAssignee').value    = issue.assignee || '';
        document.getElementById('issueStatus').value      = issue.status;
        document.getElementById('issueDescription').value = issue.description || '';
    } else {
        document.getElementById('issueModalTitle').textContent = '🐛 Nuovo Issue';
        document.getElementById('issueTitle').value       = '';
        document.getElementById('issuePriority').value    = 'media';
        document.getElementById('issueAssignee').value    = '';
        document.getElementById('issueStatus').value      = 'aperto';
        document.getElementById('issueDescription').value = '';
    }

    // Inizializza editor markdown per la descrizione (se disponibile)
    if (typeof createMarkdownEditor === 'function') {
        createMarkdownEditor('issueDescription', null, isViewOnly);
    }
}

/** Chiude il modal issue e resetta lo stato del modulo. */
export function closeIssueModal() {
    const modal = document.getElementById('issueModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    _editingIssueId = null;
}

/**
 * Salva l'issue corrente (nuovo o modifica) raccogliendo i dati dal modal.
 * Persiste aggiornando il progetto parent.
 */
export async function saveIssue() {
    const project = _currentProject();
    if (!project) return;

    const title       = document.getElementById('issueTitle')?.value.trim() || '';
    const priority    = document.getElementById('issuePriority')?.value || '';
    const assignee    = document.getElementById('issueAssignee')?.value || '';
    const status      = document.getElementById('issueStatus')?.value || '';
    const description = document.getElementById('issueDescription')?.value.trim() || '';

    if (!title || !priority || !status) {
        alert('⚠️ Compila tutti i campi obbligatori');
        return;
    }

    const issue = {
        title,
        priority,
        assignee:    assignee || null,
        status,
        description,
        createdAt:   _editingIssueId !== null
            ? project.issues[_editingIssueId].createdAt
            : new Date().toISOString()
    };

    if (!project.issues) project.issues = [];

    if (_editingIssueId !== null) {
        project.issues[_editingIssueId] = issue;
    } else {
        project.issues.push(issue);
    }

    await db.save('projects', project);
    closeIssueModal();
    renderProjectIssues();
}

/** Apre il modal in modalità modifica per l'issue all'indice index. */
export function editIssue(index) {
    openIssueModal(index);
}

/** Apre il modal in sola lettura per l'issue all'indice index. */
export function viewIssue(index) {
    openIssueModal(index, true);
}

/**
 * Elimina l'issue all'indice index dal progetto corrente.
 * @param {number} index - indice nell'array project.issues
 */
export async function deleteIssue(index) {
    if (!confirm('Eliminare questo issue?')) return;

    const project = _currentProject();
    if (!project || !project.issues) return;

    project.issues.splice(index, 1);
    await db.save('projects', project);
    renderProjectIssues();
}
