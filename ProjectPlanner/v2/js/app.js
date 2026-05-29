/**
 * js/app.js  –  Entry point dell'applicazione v2
 *
 * Responsabilità:
 *  - Inizializzazione del DB (backend o IDB offline)
 *  - Caricamento di tutti i dati nello stato globale
 *  - Gestione tab, tema, indicatore connessione
 *  - Esposizione di tutte le funzioni pubbliche a window
 *    (necessario perché il template HTML usa onclick="...")
 */

import * as db from './db.js';
import * as state from './state.js';
import { hoursToHHMM, formatDateLocal } from './helpers.js';

// ─── Moduli ───────────────────────────────────────────────────────────────────
// Importati man mano che vengono implementati.
// Ogni import viene commentato fino a quando il file non esiste.

import * as Holidays    from './modules/holidays.js';
import * as Resources   from './modules/resources.js';
import * as Projects    from './modules/projects.js';
import * as Tasks       from './modules/tasks.js';
import * as Milestones  from './modules/milestones.js';
import * as Templates   from './modules/templates.js';
import * as Meetings    from './modules/meetings.js';
import * as Plants      from './modules/plants.js';
import * as Gantt       from './modules/gantt.js';
import * as ResourceView from './modules/resourceView.js';
import * as Bacheca     from './modules/bacheca.js';
import * as Warnings    from './modules/warnings.js';
import * as Dashboard   from './modules/dashboard.js';
import * as Annotations from './modules/annotations.js';
import * as Offers      from './modules/offers.js';
import * as ExportImport from './modules/exportImport.js';
import * as ActivityMap from './modules/activityMap.js';
import * as CheckpointCalendar from './modules/checkpointCalendar.js';
import * as TaskReview  from './modules/taskReview.js';
import * as QuickNotes  from './modules/quickNotes.js';
import * as Auth        from './modules/auth.js';
import * as Users       from './modules/users.js';

// ─── Caricamento dati ─────────────────────────────────────────────────────────

async function loadAllData() {
  // Risorse
  let resources = await db.getAll('resources');
  // Assegna ordine a risorse senza (retrocompatibilità)
  let resourcesNeedSave = false;
  resources.forEach((r, i) => {
    if (r.order === undefined) { r.order = i; resourcesNeedSave = true; }
  });
  resources.sort((a, b) => (a.order || 0) - (b.order || 0));
  state.setResources(resources);

  // Festività locali
  state.setLocalHolidays(await db.getAll('localHolidays'));

  // Progetti
  const projects = await db.getAll('projects');
  // Migra completamento per-risorsa (retrocompatibilità)
  let projectsNeedSave = false;
  projects.forEach(project => {
    if (project.tasks) {
      project.tasks.forEach(task => {
        if (task.resources && task.resources.length > 0) {
          task.resources.forEach(res => {
            if (res.completion === undefined) {
              res.completion = task.completion > 0 ? task.completion : 0;
              projectsNeedSave = true;
            }
          });
        }
      });
    }
  });
  state.setProjects(projects);

  // Templates
  state.setTemplates(await db.getAll('templates'));

  // Riunioni globali (con migrazione formato durata)
  let meetings = await db.getAll('meetings');
  let meetingsNeedSave = false;
  meetings.forEach(m => {
    if (m.expectedDuration !== null && m.expectedDuration !== undefined && typeof m.expectedDuration === 'number') {
      m.expectedDuration = hoursToHHMM(m.expectedDuration);
      meetingsNeedSave = true;
    }
    if (m.actualDuration !== null && m.actualDuration !== undefined && typeof m.actualDuration === 'number') {
      m.actualDuration = hoursToHHMM(m.actualDuration);
      meetingsNeedSave = true;
    }
  });
  state.setMeetings(meetings);

  // Stabilimenti
  state.setPlants(await db.getAll('plants'));

  // Appunti calendario (con migrazione formato)
  // QuickNotes sono salvati come setting (non hanno uno store dedicato)
  // Il backend li restituisce già deserializzati; IDB li salva come array
  const rawQN = await db.getSetting('quickNotes');
  let quickNotes = Array.isArray(rawQN) ? rawQN : [];
  // Caso raro: setting salvata come stringa JSON da versioni precedenti
  if (!quickNotes.length && typeof rawQN === 'string') {
    try { quickNotes = JSON.parse(rawQN) ?? []; } catch (_) { /* ignore */ }
  }
  let quickNotesNeedSave = false;
  quickNotes.forEach(note => {
    if (!note.date) {
      note.date = note.createdAt ? note.createdAt.substring(0, 10) : formatDateLocal(new Date());
      quickNotesNeedSave = true;
    }
    if (!note.time) { note.time = '09:00'; quickNotesNeedSave = true; }
    if (!Array.isArray(note.tags)) {
      note.tags = (typeof note.tags === 'string' && note.tags.trim())
        ? note.tags.split(',').map(t => t.trim()).filter(Boolean)
        : [];
      quickNotesNeedSave = true;
    }
    if (typeof note.confirmed !== 'boolean') {
      note.confirmed = false;
      quickNotesNeedSave = true;
    }
  });
  state.setQuickNotes(quickNotes);

  // Impostazioni resourceTypes
  // db.getSetting restituisce già il valore deserializzato (il backend fa JSON.parse)
  const rtSetting = await db.getSetting('resourceTypes');
  if (rtSetting) {
    state.setResourceTypes(rtSetting);
  }
}

// ─── Tema ─────────────────────────────────────────────────────────────────────

export async function toggleTheme() {
  const current  = document.documentElement.getAttribute('data-theme');
  const newTheme = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  await db.setSetting('theme', newTheme);
}

async function loadTheme() {
  const saved = await db.getSetting('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

// ─── Indicatore connessione ────────────────────────────────────────────────────

function updateConnectionIndicator(online) {
  const el = document.getElementById('dbStatusIndicator');
  if (!el) return;
  el.classList.remove('online', 'offline', 'syncing');
  el.classList.add(online ? 'online' : 'offline');
  el.title = online ? 'Database connesso' : 'Database offline – dati locali';
}

window.addEventListener('db:connectionChanged', (e) => {
  updateConnectionIndicator(e.detail.online);
});

// ─── Tab switching ────────────────────────────────────────────────────────────

export function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  // Il button che ha scatenato il click
  const _ev = window.event;
  if (_ev && _ev.target) _ev.target.classList.add('active');
  const panel = document.getElementById(tabName);
  if (panel) panel.classList.add('active');

  // Lazy render per tab costose
  if (tabName === 'gantt')              Gantt.renderGantt();
  if (tabName === 'resourceView')       { ResourceView.updateResourceViewPeriod?.(); ResourceView.renderResourceView(); }
  if (tabName === 'bacheca')            Bacheca.renderBacheca();
  if (tabName === 'warnings')           Warnings.renderWarnings();
  if (tabName === 'taskReview')         TaskReview.renderTaskReview();
  if (tabName === 'meetings')           { Meetings.renderGlobalMeetings(); Meetings.updateMeetingTagsSuggestions?.(); }
  if (tabName === 'offerte')            Offers.renderOffersOverview();
  if (tabName === 'projects')           Projects.closeProjectDetails();
  if (tabName === 'plants')             Plants.renderPlants();
  if (tabName === 'activityMap')        ActivityMap.renderActivityMap();
  if (tabName === 'annotations')        Annotations.renderAnnotations();
  if (tabName === 'quickNotes')         QuickNotes.renderQuickNotes();
  if (tabName === 'dashboard')          Dashboard.renderDashboard();
  if (tabName === 'checkpointCalendar') CheckpointCalendar.renderCheckpointCalendar();
}

// ─── Restrizioni ruolo personal ──────────────────────────────────────────────

/**
 * Applica le restrizioni UI basate sul ruolo dell'utente corrente.
 * Sempre ripristina tutti i tab prima di applicare le restrizioni specifiche.
 * Imposta body.dataset.userRole usato da helpers.openModal per il viewer.
 */
function applyRoleRestrictions() {
  const user = Auth.getCurrentUser();
  const role = user?.role || '';

  // Aggiorna attributo body (usato da openModal per viewer)
  document.body.dataset.userRole = role;

  // Ripristina sempre tutti i tab (fix: switcher da personal a altro ruolo)
  document.querySelectorAll('.tab').forEach(btn => { btn.style.display = ''; });

  if (role !== 'personal') return;

  const ALLOWED = new Set(['gantt', 'resourceView', 'projects']);

  // Nascondi tab non consentiti
  document.querySelectorAll('.tab').forEach(btn => {
    const m = btn.getAttribute('onclick')?.match(/switchTab\('([^']+)'\)/);
    if (m && !ALLOWED.has(m[1])) btn.style.display = 'none';
  });

  // Attiva il tab gantt
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const ganttBtn = document.querySelector(".tab[onclick*=\"'gantt'\"]");
  const ganttPanel = document.getElementById('gantt');
  if (ganttBtn) ganttBtn.classList.add('active');
  if (ganttPanel) ganttPanel.classList.add('active');
  Gantt.renderGantt();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initApp() {
  try {
    // Init DB (connessione backend + IDB fallback)
    await db.init();

    // Aggiorna indicatore
    updateConnectionIndicator(db.isOnline());

    // Carica tema prima di tutto il resto (evita FOUC)
    await loadTheme();

    // Carica tutti i dati
    await loadAllData();

    // Inizializza event listener del modal task
    Tasks.initTaskModal?.();

    // Calcola e renderizza
    Holidays.calculateHolidays();
    Resources.renderResources();
    Holidays.renderLocalHolidays();
    Holidays.renderHolidays();
    Projects.renderProjects();
    Templates.renderTemplates();
    Resources.updateResourceSelects();
    Projects.updateProjectSelects();
    Templates.updateTemplateSelects?.();
    Templates.updateApplyTemplateSelect?.();
    Gantt.updateGanttFilters?.();
    ResourceView.updateResourceViewFilters?.();
    Meetings.populateTimeSelect?.('globalMeetingTime');
    Dashboard.renderDashboard();

    // Applica restrizioni UI per ruolo (nasconde tab per personal, setta attributo body per viewer)
    applyRoleRestrictions();

  } catch (err) {
    console.error('Errore inizializzazione:', err);
    alert('Errore nel caricamento dei dati. Verifica la console.');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Controlla autenticazione prima di inizializzare l'app
  if (!Auth.isAuthenticated()) {
    Auth.showLoginOverlay();
  } else {
    await initApp();
    Auth.hideLoginOverlay();
    Auth.updateAuthBar();
  }
});

// Login riuscito → carica dati
window.addEventListener('auth:loggedIn', async () => {
  await initApp();
  Auth.updateAuthBar();
});

// Token scaduto / 401
window.addEventListener('auth:unauthorized', () => {
  Auth.logout();
});

// ─── Handler eventi cross-modulo ─────────────────────────────────────────────
// I moduli usano CustomEvent('app:viewRefresh', { detail: { views: [...] } })
// per richiedere l'aggiornamento di viste senza dipendenze circolari.

window.addEventListener('app:viewRefresh', (e) => {
  const views = e.detail?.views ?? [];
  if (views.includes('gantt'))              Gantt.renderGantt?.();
  if (views.includes('resourceView'))       ResourceView.renderResourceView?.();
  if (views.includes('bacheca'))            Bacheca.renderBacheca?.();
  if (views.includes('warnings'))           Warnings.renderWarnings?.();
  if (views.includes('dashboard'))          Dashboard.renderDashboard?.();
  if (views.includes('projects'))           Projects.renderProjects?.();
  if (views.includes('resources'))          Resources.renderResources?.();
  if (views.includes('holidays'))           { Holidays.calculateHolidays?.(); Holidays.renderHolidays?.(); }
  if (views.includes('taskLinks'))          Projects.applyTaskLinks?.();
});

// Handler per apertura task da altri contesti (bacheca, annotations, taskReview)
window.addEventListener('app:openTask', (e) => {
  const { projectId, taskId } = e.detail ?? {};
  if (projectId) state.setCurrentProjectId(projectId);
  if (taskId) Tasks.openTaskModal?.(taskId);
});

// ─── Esposizione globale ──────────────────────────────────────────────────────
// Le funzioni usate negli handler onclick="" del template HTML devono essere
// accessibili globalmente. Le esportiamo su window.

// App
window.switchTab   = switchTab;
window.toggleTheme = toggleTheme;

// Holidays
window.calculateHolidays        = Holidays.calculateHolidays;
window.renderHolidays           = Holidays.renderHolidays;
window.openLocalHolidayModal    = Holidays.openLocalHolidayModal;
window.closeLocalHolidayModal   = Holidays.closeLocalHolidayModal;
window.saveLocalHoliday         = Holidays.saveLocalHoliday;
window.deleteLocalHoliday       = Holidays.deleteLocalHoliday;

// Resources
window.saveResource             = Resources.saveResource;
window.editResource             = Resources.editResource;
window.deleteResource           = Resources.deleteResource;
window.openResourceModal        = Resources.openResourceModal;
window.closeResourceModal       = Resources.closeResourceModal;
window.moveResourceUp           = Resources.moveResourceUp;
window.moveResourceDown         = Resources.moveResourceDown;
window.toggleResourceVisibility = Resources.toggleResourceVisibility;
window.updateResourceSelects    = Resources.updateResourceSelects;
window.resourcesModule          = Resources;  // namespace usato nell'HTML generato da renderResources

// Projects
window.saveProject              = Projects.saveProject;
window.renderProjects           = Projects.renderProjects;
window.openProjectModal         = Projects.openProjectModal;
window.closeProjectModal        = Projects.closeProjectModal;
window.openProjectDetails       = Projects.openProjectDetails;
window.closeProjectDetails      = Projects.closeProjectDetails;
window.deleteProject            = Projects.deleteProject;
window.updateProjectSelects     = Projects.updateProjectSelects;
window.duplicateProject         = Projects.duplicateProject;

// Tasks
window.saveTask                 = Tasks.saveTask;
window.editTask                 = Tasks.editTask;
window.deleteTask               = Tasks.deleteTask;
window.openTaskModal            = Tasks.openTaskModal;
window.closeTaskModal           = Tasks.closeTaskModal;
window.calculateEndDate         = Tasks.calculateEndDate;
window.calculateStartDate       = Tasks.calculateStartDate;
window.onCalcMethodChange       = Tasks.onCalcMethodChange;
window.toggleTaskResourceRow    = Tasks.toggleTaskResourceRow;
window.addTaskResourceRow       = Tasks.addTaskResourceRow;
window.removeTaskResourceRow    = Tasks.removeTaskResourceRow;
window.updateLinkedDates        = Tasks.updateLinkedDates;

// Milestones
window.saveMilestone            = Milestones.saveMilestone;
window.deleteMilestone          = Milestones.deleteMilestone;
window.openMilestoneModal       = Milestones.openMilestoneModal;
window.closeMilestoneModal      = Milestones.closeMilestoneModal;

// Templates
window.saveTemplate             = Templates.saveTemplate;
window.deleteTemplate           = Templates.deleteTemplate;
window.openTemplateModal        = Templates.openTemplateModal;
window.closeTemplateModal       = Templates.closeTemplateModal;
window.applyTemplate            = Templates.applyTemplate;
window.openTemplateDetails      = Templates.openTemplateDetails;
window.closeTemplateDetails     = Templates.closeTemplateDetails;
window.saveTemplateTask         = Templates.saveTemplateTask;
window.deleteTemplateTask       = Templates.deleteTemplateTask;
window.openTemplateTaskModal    = Templates.openTemplateTaskModal;
window.closeTemplateTaskModal   = Templates.closeTemplateTaskModal;
window.saveTemplateMilestone    = Templates.saveTemplateMilestone;
window.deleteTemplateMilestone  = Templates.deleteTemplateMilestone;
window.openTemplateMilestoneModal  = Templates.openTemplateMilestoneModal;
window.closeTemplateMilestoneModal = Templates.closeTemplateMilestoneModal;
window.openTemplateGroupModal      = Templates.openTemplateGroupModal;
window.closeTemplateGroupModal     = Templates.closeTemplateGroupModal;
window.saveTemplateGroup           = Templates.saveTemplateGroup;
window.deleteTemplateGroup         = Templates.deleteTemplateGroup;

// Meetings
window.saveGlobalMeeting        = Meetings.saveGlobalMeeting;
window.deleteGlobalMeeting      = Meetings.deleteGlobalMeeting;
window.editGlobalMeeting        = Meetings.editGlobalMeeting;
window.viewGlobalMeeting        = Meetings.viewGlobalMeeting;
window.openGlobalMeetingModal   = Meetings.openGlobalMeetingModal;
window.closeGlobalMeetingModal  = Meetings.closeGlobalMeetingModal;
window.renderGlobalMeetings     = Meetings.renderGlobalMeetings;
window.toggleRecurringFields    = Meetings.toggleRecurringFields;
window.updateMeetingTagsSuggestions = Meetings.updateMeetingTagsSuggestions;
window.saveProjectMeeting       = Meetings.saveProjectMeeting;
window.deleteProjectMeeting     = Meetings.deleteProjectMeeting;
window.openProjectMeetingModal  = Meetings.openProjectMeetingModal;
window.closeProjectMeetingModal = Meetings.closeProjectMeetingModal;

// Plants
window.savePlant                = Plants.savePlant;
window.deletePlant              = Plants.deletePlant;
window.openPlantModal           = Plants.openPlantModal;
window.closePlantModal          = Plants.closePlantModal;
window.renderPlants             = Plants.renderPlants;

// Gantt
window.renderGantt              = Gantt.renderGantt;
window.renderGanttByProjects    = Gantt.renderGanttByProjects;
window.renderGanttByResources   = Gantt.renderGanttByResources;
window.updateGanttFilters       = Gantt.updateGanttFilters;
window.ganttToday               = Gantt.ganttToday;
window.ganttPrev                = Gantt.ganttPrev;
window.ganttNext                = Gantt.ganttNext;

// ResourceView
window.renderResourceView         = ResourceView.renderResourceView;
window.updateResourceViewPeriod   = ResourceView.updateResourceViewPeriod;
window.updateResourceViewFilters  = ResourceView.updateResourceViewFilters;

// Bacheca
window.renderBacheca            = Bacheca.renderBacheca;
window.moveTask                 = Bacheca.moveTask;

// Warnings
window.renderWarnings           = Warnings.renderWarnings;
window.saveWarningFilters       = Warnings.saveWarningFilters;
window.toggleWarningFiltersPanel = Warnings.toggleWarningFiltersPanel;

// TaskReview
window.renderTaskReview         = TaskReview.renderTaskReview;
window.toggleTaskSelection      = TaskReview.toggleTaskSelection;
window.analyzeSelectedTasks     = TaskReview.analyzeSelectedTasks;

// Dashboard
window.renderDashboard          = Dashboard.renderDashboard;

// Annotations
window.renderAnnotations        = Annotations.renderAnnotations;
window.saveAnnotation           = Annotations.saveAnnotation;
window.deleteAnnotation         = Annotations.deleteAnnotation;
window.openAnnotationModal      = Annotations.openAnnotationModal;
window.closeAnnotationModal     = Annotations.closeAnnotationModal;

// Offers
window.renderOffersOverview     = Offers.renderOffersOverview;
window.saveOffer                = Offers.saveOffer;
window.deleteOffer              = Offers.deleteOffer;
window.openOfferModal           = Offers.openOfferModal;
window.closeOfferModal          = Offers.closeOfferModal;

// ExportImport
window.exportData               = ExportImport.exportData;
window.importData               = ExportImport.importData;
window.importDataMerge          = ExportImport.importDataMerge;
window.wipeDatabase             = ExportImport.wipeDatabase;

// ActivityMap
window.renderActivityMap        = ActivityMap.renderActivityMap;

// CheckpointCalendar
window.renderCheckpointCalendar = CheckpointCalendar.renderCheckpointCalendar;

// QuickNotes
window.renderQuickNotes                 = QuickNotes.renderQuickNotes;
window.saveQuickNote                    = QuickNotes.saveQuickNote;
window.deleteQuickNote                  = QuickNotes.deleteQuickNote;
window.openQuickNoteModal               = QuickNotes.openQuickNoteModal;
window.closeQuickNoteModal              = QuickNotes.closeQuickNoteModal;
window.toggleQuickNoteConfirmed         = QuickNotes.toggleQuickNoteConfirmed;
window.addQuickNote                     = QuickNotes.saveQuickNote;

// Tasks (funzioni aggiuntive usate inline nell'HTML)
window.changeTaskStatus                 = Tasks.changeTaskStatus;
window.deleteTaskFromModal              = Tasks.deleteTaskFromModal;
window.toggleFlexibleDate               = Tasks.toggleFlexibleDate;
window.showAbsenceWarning               = Tasks.showAbsenceWarning;
window.sendTaskEmail                    = Tasks.sendTaskEmail;
window.clearEmailSentDate               = Tasks.clearEmailSentDate;
window.toggleTaskAnalysisSelection      = Tasks.toggleTaskAnalysisSelection;
window.updateTaskSelectionBar           = Tasks.updateTaskSelectionBar;
window.clearTaskAnalysisSelection       = Tasks.clearTaskAnalysisSelection;
window.analizzaRisorsePerAttivita       = Tasks.analizzaRisorsePerAttivita;
window.renderTasks                      = Tasks.renderTasks;
window.updateTrackingDaysDiff           = Tasks.updateTrackingDaysDiff;
window.applyTaskLinks                   = Projects.applyTaskLinks;
// Task Groups
window.openGroupModal                   = Tasks.openGroupModal;
window.closeGroupModal                  = Tasks.closeGroupModal;
window.saveGroup                        = Tasks.saveGroup;
window.deleteGroup                      = Tasks.deleteGroup;

// Projects (funzioni aggiuntive)
window.calculateProjectStats            = Projects.calculateProjectStats;
window.renderProjectDaysSummary         = Projects.renderProjectDaysSummary;
window.showProjectsStatistics           = Projects.showProjectsStatistics;
window.renderProjectGeneralInfo         = Projects.renderProjectGeneralInfo;
window.saveProjectGeneralInfo           = Projects.saveProjectGeneralInfo;
window.addProjectUpdate                 = Projects.addProjectUpdate;
window.deleteProjectUpdate              = Projects.deleteProjectUpdate;
window.viewUpdate                       = Projects.viewUpdate;
window.closeUpdateModal                 = Projects.closeUpdateModal;

// Resources (funzioni aggiuntive)
window.openResourceTypesSettings        = Resources.openResourceTypesSettings;
window.closeResourceTypesSettings       = Resources.closeResourceTypesSettings;
window.addResourceType                  = Resources.addResourceType;
window.renderResourceTypes              = Resources.renderResourceTypesList;
window.saveResourceTypes                = Resources.saveResourceTypes;
window.addResourceTypeRow               = Resources.addResourceType;
window.removeResourceTypeRow            = Resources.removeResourceType;
window.addAbsenceRow                    = Resources.addAbsenceRow;
window.removeAbsenceRow                 = Resources.removeAbsenceRow;
window.addPermessoRow                   = Resources.addPermessoRow;
window.removePermessoRow                = Resources.removePermessoRow;
window.previewResourceCalendar          = Resources.previewResourceCalendar;
window.resourceCalPrev                  = Resources.resourceCalPrev;
window.resourceCalNext                  = Resources.resourceCalNext;
window.exportResourceMarkdown           = Resources.exportResourceMarkdown;

// Plants (funzioni aggiuntive)
window.geocodePlantAddress              = Plants.geocodePlantAddress;
window.updatePlantSelect                = Plants.updatePlantSelect;
window.updatePlantInfoBadge             = Plants.updatePlantInfoBadge;
window.togglePlantSelector              = Plants.togglePlantSelector;

// Meetings (funzioni aggiuntive)
window.populateTimeSelect               = Meetings.populateTimeSelect;
window.filterMeetings                   = Meetings.filterMeetings;
window.exportMeetingICS                 = Meetings.exportMeetingICS;
window.renderProjectMeetings            = Meetings.renderProjectMeetings;

// Gantt (funzioni aggiuntive)
window.ganttZoomIn                      = Gantt.ganttZoomIn;
window.ganttZoomOut                     = Gantt.ganttZoomOut;
window.switchGanttView                  = Gantt.switchGanttView;

// ResourceView (funzioni aggiuntive)
window.resourceViewPrev                 = ResourceView.resourceViewPrev;
window.resourceViewNext                 = ResourceView.resourceViewNext;
window.resourceViewToday                = ResourceView.resourceViewToday;
window.expandAllResources               = ResourceView.expandAllResources;
window.collapseAllResources             = ResourceView.collapseAllResources;
window.toggleResourceCollapse           = ResourceView.toggleResourceCollapse;
window.openFlexibleTaskFromResourceView = ResourceView.openFlexibleTaskFromResourceView;

// TaskReview (funzioni aggiuntive)
window.updateTaskReviewTotal            = TaskReview.updateTaskReviewTotal;
window.toggleAllTaskReviewSelection     = TaskReview.toggleAllTaskReviewSelection;
window.sendTaskReviewEmail              = TaskReview.sendTaskReviewEmail;
window.openTaskFromReview               = TaskReview.openTaskFromReview;
window.closeTaskReviewAnalysisPanel     = TaskReview.closeTaskReviewAnalysisPanel;

// Dashboard
window.navigateToProject                = Dashboard.navigateToProject;

// Bacheca
window.openTaskFromBacheca              = Bacheca.openTaskFromBacheca;

// Annotations
window.openTaskFromAnnotations          = Annotations.openTaskFromAnnotations;

// Offers
window.openIssueModal                   = Offers.openIssueModal;
window.closeIssueModal                  = Offers.closeIssueModal;
window.saveIssue                        = Offers.saveIssue;
window.deleteIssue                      = Offers.deleteIssue;
window.editOffer                        = Offers.editOffer;
window.editIssue                        = Offers.editIssue;

// Auth
window.doLogin                  = Auth.doLogin;
window.authLogout               = Auth.logout;
window.openChangePasswordModal  = Auth.openChangePasswordModal;
window.closeChangePasswordModal = Auth.closeChangePasswordModal;
window.doChangePassword         = Auth.doChangePassword;

// Users
window.openUsersModal        = Users.openUsersModal;
window.closeUsersModal       = Users.closeUsersModal;
window.saveUser              = Users.saveUser;
window.editUser              = Users.editUser;
window.deleteUser            = Users.deleteUser;
window.updateUserFormForRole = Users.updateUserFormForRole;

// CheckpointCalendar
window.checkpointCalPrev                = CheckpointCalendar.checkpointCalPrev;
window.checkpointCalNext                = CheckpointCalendar.checkpointCalNext;
window.checkpointCalToday               = CheckpointCalendar.checkpointCalToday;

// ActivityMap
window.activityMapPrev                  = ActivityMap.activityMapPrev;
window.activityMapNext                  = ActivityMap.activityMapNext;
window.activityMapToday                 = ActivityMap.activityMapToday;
