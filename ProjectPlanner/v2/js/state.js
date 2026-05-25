/**
 * js/state.js  –  Stato globale condiviso dell'applicazione
 *
 * Tutti i moduli importano da qui le variabili di stato condivise.
 * Usare le funzioni set* per mutare lo stato in modo tracciabile.
 *
 * NOTA: In ES Modules le variabili esportate sono live bindings, quindi
 * ogni modulo che importa `resources` legge sempre il valore aggiornato.
 * Tuttavia, per reasignare array interi usare i setter qui sotto.
 */

// ─── Dati principali ──────────────────────────────────────────────────────────

export let resources     = [];
export let projects      = [];
export let templates     = [];
export let meetings      = [];   // Riunioni globali
export let plants        = [];   // Stabilimenti clienti
export let holidays      = [];   // Festività calcolate (nazionali + locali)
export let localHolidays = [];   // Festività locali ricorrenti (raw)
export let quickNotes    = [];   // Appunti calendario

/** Tipi risorsa configurabili (aggiornati dalle settings) */
export let resourceTypes = [
  { value: 'programmatore-robot', label: 'Programmatore Robot' },
  { value: 'programmatore-plc',   label: 'Programmatore PLC' },
  { value: 'programmatore-visione', label: 'Programmatore Visione' },
  { value: 'meccanico',           label: 'Meccanico' },
  { value: 'elettricista',        label: 'Elettricista' },
  { value: 'project-manager',     label: 'Project Manager' },
  { value: 'esterno',             label: 'Esterno' },
  { value: 'responsabile',        label: 'Responsabile' }
];

// ─── Stato UI ─────────────────────────────────────────────────────────────────

export let currentProjectId              = null;
export let currentTemplateId             = null;
export let editingResourceId             = null;
export let editingMilestoneId            = null;
export let editingTaskId                 = null;
export let editingLocalHolidayId         = null;
export let editingTemplateMilestoneId    = null;
export let editingTemplateTaskId         = null;
export let editingGlobalMeetingId        = null;
export let suggestedStartDate            = null;
export let suggestedResourceId           = null;
export let collapsedResources            = {};
export let selectedTasksForAnalysis      = new Set();

// ─── Setter (necessari perché ES Module bindings sono read-only dall'esterno) ─

export function setResources(v)     { resources     = v; }
export function setProjects(v)      { projects      = v; }
export function setTemplates(v)     { templates     = v; }
export function setMeetings(v)      { meetings      = v; }
export function setPlants(v)        { plants        = v; }
export function setHolidays(v)      { holidays      = v; }
export function setLocalHolidays(v) { localHolidays = v; }
export function setQuickNotes(v)    { quickNotes    = v; }
export function setResourceTypes(v) { resourceTypes = v; }

export function setCurrentProjectId(v)           { currentProjectId           = v; }
export function setCurrentTemplateId(v)          { currentTemplateId          = v; }
export function setEditingResourceId(v)          { editingResourceId          = v; }
export function setEditingMilestoneId(v)         { editingMilestoneId         = v; }
export function setEditingTaskId(v)              { editingTaskId              = v; }
export function setEditingLocalHolidayId(v)      { editingLocalHolidayId      = v; }
export function setEditingTemplateMilestoneId(v) { editingTemplateMilestoneId = v; }
export function setEditingTemplateTaskId(v)      { editingTemplateTaskId      = v; }
export function setEditingGlobalMeetingId(v)     { editingGlobalMeetingId     = v; }
export function setSuggestedStartDate(v)         { suggestedStartDate         = v; }
export function setSuggestedResourceId(v)        { suggestedResourceId        = v; }
export function setCollapsedResources(v)         { collapsedResources         = v; }
