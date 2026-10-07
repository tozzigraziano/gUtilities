# Prompt: Project Planner – Versione Server Multi-Utente

> **Contesto**: Questo prompt descrive la riscrittura completa dell'applicazione "Pianificazione Risorse e Progetti" da una Single Page App monolitica (singolo file HTML + IndexedDB locale) a un'applicazione web full-stack multi-utente, accessibile da qualsiasi dispositivo connesso alla rete aziendale.
>
> L'applicazione esistente è descritta in dettaglio nelle sezioni dedicate. Non inventare funzionalità non elencate; implementa esattamente quanto specificato in ogni sezione.

---

## INDICE

1. [Obiettivi e Requisiti Generali](#1-obiettivi-e-requisiti-generali)
2. [Stack Tecnologico e Architettura](#2-stack-tecnologico-e-architettura)
3. [Schema Database](#3-schema-database)
4. [Autenticazione e Gestione Utenti](#4-autenticazione-e-gestione-utenti)
5. [Backend – API REST](#5-backend--api-rest)
6. [Frontend – Struttura e Navigazione](#6-frontend--struttura-e-navigazione)
7. [Funzionalità Esistenti da Portare](#7-funzionalità-esistenti-da-portare)
   - 7.1 [Gestione Risorse](#71-gestione-risorse)
   - 7.2 [Gestione Festività](#72-gestione-festività)
   - 7.3 [Gestione Progetti](#73-gestione-progetti)
   - 7.4 [Gestione Attività (Task)](#74-gestione-attività-task)
   - 7.5 [Gestione Milestone](#75-gestione-milestone)
   - 7.6 [Gantt Chart](#76-gantt-chart)
   - 7.7 [Bacheca Kanban](#77-bacheca-kanban)
   - 7.8 [Vista Risorse (Timeline)](#78-vista-risorse-timeline)
   - 7.9 [Dashboard Giornaliera](#79-dashboard-giornaliera)
   - 7.10 [Pagina Avvisi](#710-pagina-avvisi)
   - 7.11 [Revisione Attività](#711-revisione-attività)
   - 7.12 [Annotazioni Attività](#712-annotazioni-attività)
   - 7.13 [Gestione Template](#713-gestione-template)
   - 7.14 [Riunioni Globali](#714-riunioni-globali)
   - 7.15 [Offerte (per Progetto)](#715-offerte-per-progetto)
   - 7.16 [Issue (per Progetto)](#716-issue-per-progetto)
   - 7.17 [Aggiornamenti Progetto](#717-aggiornamenti-progetto)
   - 7.18 [Gestione Stabilimenti (Plants)](#718-gestione-stabilimenti-plants)
   - 7.19 [Mappa Attività](#719-mappa-attività)
   - 7.20 [Calendario Punti di Controllo](#720-calendario-punti-di-controllo)
   - 7.21 [Import / Export](#721-import--export)
8. [Nuove Funzionalità](#8-nuove-funzionalità)
   - 8.1 [Portale Risorsa (Vista Limitata)](#81-portale-risorsa-vista-limitata)
   - 8.2 [Richiesta Ferie e Permessi](#82-richiesta-ferie-e-permessi)
   - 8.3 [Commenti con Menzioni alle Attività](#83-commenti-con-menzioni-alle-attività)
9. [UI / UX](#9-ui--ux)
10. [Deployment e Configurazione Server](#10-deployment-e-configurazione-server)

---

## 1. Obiettivi e Requisiti Generali

Costruire un'applicazione web accessibile da più dispositivi in rete locale (o internet) che replichi integralmente le funzionalità dell'attuale Project Planner, aggiungendo:

- **Autenticazione** per ogni utente con sessioni sicure.
- **Ruoli**: `admin` (accesso completo, corrisponde al pianificatore) e `resource` (accesso limitato alla propria vista).
- **Dati condivisi**: tutto il team vede la stessa pianificazione in tempo reale.
- **Portale risorsa**: ogni risorsa può vedere i propri progetti assegnati (pianificazione completa del progetto, non solo le proprie attività).
- **Ferie e permessi**: ogni risorsa può richiedere ferie/permessi; l'admin approva o rifiuta; il sistema aggiorna automaticamente le assenze nel profilo risorsa.
- **Commenti con menzioni**: su ogni attività è possibile lasciare commenti con `@nomeutente`; le menzioni generano notifiche.

**Lingua dell'interfaccia**: Italiano / Inglese.
**Accessibilità**: l'app deve funzionare da desktop, tablet e smartphone.

---

## 2. Stack Tecnologico e Architettura

### Backend
| Componente | Tecnologia |
|---|---|
| Runtime | Node.js (LTS) |
| Framework HTTP | Express.js |
| ORM | Prisma (con PostgreSQL) |
| Autenticazione | JWT (access token 15 min + refresh token 7 giorni, httpOnly cookie) |
| Password hashing | bcrypt (cost factor ≥ 12) |
| WebSocket | `ws` o `socket.io` per notifiche real-time |
| Validazione input | Zod |
| Logging | Morgan (HTTP) + Winston (app) |

### Database
| Componente | Tecnologia |
|---|---|
| DBMS | PostgreSQL (≥ 15) |
| Migrations | Prisma Migrate |

### Frontend
| Componente | Tecnologia |
|---|---|
| Framework | Vue 3 (Composition API) o React 18 – scegli il più adatto |
| Build tool | Vite |
| Routing | Vue Router 4 / React Router 6 |
| State management | Pinia / Zustand |
| HTTP client | Axios |
| Markdown | marked.js |
| Mappe | Leaflet 1.9.4 |
| Gantt | Rendering custom con CSS Grid (come nell'app attuale) |
| Grafici | Chart.js (per dashboard KPI) |

### Architettura
```
[Browser] ──HTTPS──► [Node.js / Express API]
                            │
                     [PostgreSQL DB]
                            │
                     [WebSocket server]  ◄── push notifiche
```

- Il frontend è servito come SPA statica dalla stessa istanza Express (o da un web server separato, es. Nginx).
- Tutte le comunicazioni API usano `/api/v1/` come prefisso.
- I file di configurazione sensibili (DB connection string, JWT secret) sono in variabili d'ambiente (file `.env`, non committato).

---

## 3. Schema Database

Di seguito le tabelle principali. Ogni tabella ha `created_at` e `updated_at` automatici (Prisma `@default(now())` e `@updatedAt`).

### `users`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| email | String UNIQUE | login |
| password_hash | String | bcrypt |
| role | Enum: `admin`, `resource` | |
| resource_id | UUID FK → resources | nullable; collega l'utente alla risorsa corrispondente |
| is_active | Boolean | default true |
| last_login | DateTime | nullable |

### `resources`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| first_name | String | |
| last_name | String | |
| role | String | ruolo lavorativo |
| department | String | nullable |
| color | String | hex color |
| icon | String | emoji/icon |
| hidden | Boolean | default false |
| sort_order | Integer | ordine di visualizzazione |
| hours_per_day | Float | default 8; ore lavorative giornaliere da contratto |
| working_days | JSON | default [1,2,3,4,5]; array dei giorni lavorativi settimanali (0=Dom … 6=Sab) |

### `absences`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| resource_id | UUID FK | |
| start_date | Date | |
| end_date | Date | |
| type | Enum: `ferie`, `malattia`, `permesso`, `altro` | |
| approved | Boolean | default false per richieste resource; default true se inserita da admin |
| requested_by | UUID FK → users | nullable |
| approved_by | UUID FK → users | nullable |
| notes | Text | nullable |

### `permits` (permessi orari)
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| resource_id | UUID FK | |
| date | Date | |
| start_time | Time | |
| end_time | Time | |
| approved | Boolean | default false per richieste resource |
| requested_by | UUID FK → users | nullable |
| approved_by | UUID FK → users | nullable |
| notes | Text | nullable |

### `leave_requests` (richieste ferie/permessi in attesa)
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| resource_id | UUID FK | |
| requested_by | UUID FK → users | |
| type | Enum: `ferie`, `permesso`, `malattia`, `altro` | |
| start_date | Date | |
| end_date | Date | nullable (per permessi orari) |
| start_time | Time | nullable |
| end_time | Time | nullable |
| status | Enum: `pending`, `approved`, `rejected` | default `pending` |
| notes | Text | nullable |
| admin_notes | Text | nullable (risposta admin) |

### `plants` (stabilimenti: sedi aziendali e sedi cliente)
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| type | Enum: `sede_aziendale`, `cliente` | |
| name | String | |
| client | String | nullable; nome cliente (valorizzato solo se type = `cliente`) |
| address | String | nullable |
| lat | Float | nullable |
| lng | Float | nullable |
| notes | Text | nullable |

### `local_holidays`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| plant_id | UUID FK → plants | nullable; se valorizzato, la festività si applica solo a quella sede (aziendale o cliente); se null = festività nazionale generica |
| date | Date | |
| name | String | |

### `projects`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| name | String | |
| description | Text | nullable |
| code | String | nullable |
| client | String | nullable |
| start_date | Date | nullable |
| end_date | Date | nullable |
| status | Enum: `attivo`, `completato`, `sospeso`, `annullato`, `offerta` | |
| notes | Text | nullable |
| general_info | Text | nullable (Markdown) |
| sort_order | Integer | |

### `milestones`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK | |
| name | String | |
| date | Date | |
| notes | Text | nullable |
| completed | Boolean | default false |

### `tasks`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK | |
| name | String | |
| start_date | Date | nullable |
| end_date | Date | nullable |
| duration | Float | ore lavorative pianificate |
| estimated_duration | Float | nullable; baseline ore (non si aggiorna con i ricalcoli automatici) |
| completion | Integer | 0–100 |
| status | Enum: `da-avviare`, `in-corso`, `completata`, `pausa`, `annullata`, `nessuno` | |
| location_type | Enum: `sede`, `cliente`, `remoto` | |
| plant_id | UUID FK → plants | nullable |
| flexible_date | Boolean | default false |
| saturday_work | Boolean | default false |
| sunday_work | Boolean | default false |
| holiday_work | Boolean | default false |
| annotation | Text | nullable |
| notes | Text | nullable (Markdown) |
| linked_milestone_id | UUID FK → milestones | nullable |
| parent_task_id | UUID FK → tasks | nullable; task di origine se creata da chiusura parziale |
| start_linked_to | UUID FK → tasks | nullable (dipendenza start) |
| end_linked_to | UUID FK → tasks | nullable (dipendenza end) |
| sort_order | Integer | |

### `task_resources` (assegnazioni risorsa→attività; una risorsa può avere più slot per la stessa attività)
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| task_id | UUID FK | |
| resource_id | UUID FK | |
| percentage | Integer | % di carico nello slot (default 100) |
| assigned_hours | Float | nullable; ore assegnate nello slot; se null = tutte le ore del task/slot |
| slot_start_date | Date | nullable; inizio slot; se null = inizio task |
| slot_end_date | Date | nullable; fine slot; se null = fine task |

### `task_interruptions`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| task_id | UUID FK | |
| date | Date | |
| priority_task_id | UUID FK → tasks | nullable |
| priority_project_id | UUID FK → projects | nullable |
| resource_id | UUID FK | nullable |

### `task_comments`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| task_id | UUID FK | |
| author_id | UUID FK → users | |
| content | Text | Markdown supportato |
| edited_at | DateTime | nullable |

### `comment_mentions`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| comment_id | UUID FK | |
| mentioned_user_id | UUID FK → users | |
| read | Boolean | default false |

### `notifications`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK | destinatario |
| type | Enum: `mention`, `leave_request`, `leave_approved`, `leave_rejected`, `task_assigned` | |
| payload | JSON | dati contestuali (task_id, comment_id, ecc.) |
| read | Boolean | default false |

### `meetings` (riunioni per progetto)
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK | nullable (globali se null) |
| name | String | |
| day_of_week | Integer | 0=Dom … 6=Sab; nullable per riunioni una-tantum |
| date | Date | nullable |
| start_time | Time | |
| end_time | Time | nullable |
| recurrent | Boolean | |
| notes | Text | nullable |

### `meeting_resources`
| Campo | Tipo | Note |
|---|---|---|
| meeting_id | UUID FK | |
| resource_id | UUID FK | |

### `offers` (offerte per progetto)
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK | |
| name | String | |
| date | Date | nullable |
| value | Decimal | nullable; totale calcolato o inserito manualmente |
| status | String | bozza / inviata / accettata / rifiutata |
| notes | Text | nullable |

### `offer_lines` (righe offerta per fase)
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| offer_id | UUID FK → offers | |
| phase | String | descrizione della fase |
| estimated_hours | Float | ore stimate per la fase |
| unit_cost | Decimal | nullable; costo orario unitario |
| sort_order | Integer | |
| notes | Text | nullable |

### `issues`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK | |
| title | String | |
| description | Text | nullable |
| severity | Enum: `bassa`, `media`, `alta`, `critica` | |
| status | Enum: `aperta`, `in-corso`, `chiusa` | |
| linked_task_id | UUID FK → tasks | nullable; attività creata o collegata per la risoluzione dell'issue |
| due_date | Date | nullable |

### `project_updates`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| project_id | UUID FK | |
| author_id | UUID FK → users | |
| title | String | nullable |
| content | Text | Markdown |

### `templates`
| Campo | Tipo | Note |
|---|---|---|
| id | UUID PK | |
| name | String | |
| description | Text | nullable |
| tasks | JSON | struttura attività template; include: name, duration (ore), estimated_duration, location_type, saturday_work, sunday_work, holiday_work, flexible_date, annotation, dependency offsets |
| milestones | JSON | struttura milestone template |

### `settings`
| Campo | Tipo | Note |
|---|---|---|
| key | String PK | |
| value | Text | |

---

## 4. Autenticazione e Gestione Utenti

### Autenticazione
- **Login** via email + password. Risposta: access token JWT (payload: `userId`, `role`, `resourceId`) + refresh token in cookie `httpOnly; Secure; SameSite=Strict`.
- **Refresh**: `POST /api/v1/auth/refresh` rinnova l'access token usando il refresh token dal cookie.
- **Logout**: invalida il refresh token lato server (blacklist in DB o cancellazione record).
- Tutti gli endpoint `/api/v1/*` (tranne `/auth/login` e `/auth/refresh`) richiedono header `Authorization: Bearer <accessToken>`.
- Blocco dopo 5 tentativi falliti consecutivi (lock 15 minuti).

### Ruoli
| Ruolo | Descrizione |
|---|---|
| `admin` | Accesso completo: CRUD su tutti gli oggetti, approvazione ferie, vista globale |
| `resource` | Accesso limitato: vede solo i progetti dove è assegnato (vista completa del progetto), può richiedere ferie/permessi, può aggiungere commenti |

### Gestione Utenti (solo admin)
- CRUD utenti: `GET /api/v1/users`, `POST /api/v1/users`, `PUT /api/v1/users/:id`, `DELETE /api/v1/users/:id` (soft delete: `is_active = false`).
- Ogni utente con ruolo `resource` deve essere collegato a una risorsa (`resource_id`). Un utente `admin` può non avere risorsa collegata.
- Reset password da parte dell'admin: genera una password temporanea e la invia via email (o la visualizza una sola volta a schermo).
- L'utente può cambiare la propria password da profilo (`PUT /api/v1/auth/change-password`).
- Pagina "Gestione Utenti" visibile solo agli admin, con tabella: Nome, Email, Ruolo, Risorsa collegata, Stato (attivo/disattivo), Ultima login.

---

## 5. Backend – API REST

Prefisso: `/api/v1/`  
Formato risposta: JSON `{ data: ..., error: null }` / `{ data: null, error: { message, code } }`  
Autenticazione: middleware JWT su tutti gli endpoint non-auth.

### Auth
```
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
PUT    /auth/change-password
GET    /auth/me
```

### Users (solo admin)
```
GET    /users
POST   /users
GET    /users/:id
PUT    /users/:id
DELETE /users/:id
POST   /users/:id/reset-password
```

### Resources
```
GET    /resources                  (tutti; admin: tutti, resource: solo se è assegnata a project)
POST   /resources                  (solo admin)
GET    /resources/:id
PUT    /resources/:id              (solo admin)
DELETE /resources/:id              (solo admin)
PUT    /resources/:id/order        (solo admin; aggiorna sort_order)
GET    /resources/:id/absences
POST   /resources/:id/absences     (solo admin; inserimento diretto)
DELETE /resources/:id/absences/:absenceId (solo admin)
GET    /resources/:id/permits
POST   /resources/:id/permits      (solo admin; inserimento diretto)
DELETE /resources/:id/permits/:permitId   (solo admin)
```

### Leave Requests (ferie/permessi)
```
GET    /leave-requests             (admin: tutte; resource: solo le proprie)
POST   /leave-requests             (crea richiesta; accesso: admin e resource)
GET    /leave-requests/:id
PUT    /leave-requests/:id/approve (solo admin; aggiorna status → approved, crea record in absences)
PUT    /leave-requests/:id/reject  (solo admin; aggiorna status → rejected)
DELETE /leave-requests/:id         (solo se status=pending e autore è il richiedente)
```

### Holidays
```
GET    /holidays/national/:year    (festività italiane calcolate)
GET    /holidays/local
POST   /holidays/local
PUT    /holidays/local/:id
DELETE /holidays/local/:id
```

### Projects
```
GET    /projects                   (admin: tutti; resource: solo dove è assegnata)
POST   /projects                   (solo admin)
GET    /projects/:id               (include tasks, milestones, meetings, offers, issues, updates)
PUT    /projects/:id               (solo admin)
DELETE /projects/:id               (solo admin)
PUT    /projects/:id/order         (solo admin)
```

### Tasks
```
GET    /projects/:projectId/tasks
POST   /projects/:projectId/tasks  (solo admin)
GET    /tasks/:id                  (include resources, comments, interruptions)
PUT    /tasks/:id                  (solo admin)
DELETE /tasks/:id                  (solo admin)
POST   /tasks/:id/split            (solo admin; divide attività)
POST   /tasks/:id/partial-close    (solo admin; chiude parzialmente e crea attività di continuazione)
POST   /tasks/:id/copy             (solo admin; copia su altro progetto)
PUT    /tasks/:id/order
```

### Task Comments
```
GET    /tasks/:taskId/comments
POST   /tasks/:taskId/comments     (admin e resource; genera notifiche per menzioni)
PUT    /comments/:id               (solo autore; max 24h dalla creazione)
DELETE /comments/:id               (solo autore o admin)
```

### Milestones
```
GET    /projects/:projectId/milestones
POST   /projects/:projectId/milestones (solo admin)
PUT    /milestones/:id              (solo admin)
DELETE /milestones/:id              (solo admin)
```

### Meetings
```
GET    /meetings                    (globali)
POST   /meetings                    (solo admin)
PUT    /meetings/:id                (solo admin)
DELETE /meetings/:id                (solo admin)
GET    /projects/:projectId/meetings
POST   /projects/:projectId/meetings (solo admin)
```

### Offers
```
GET    /projects/:projectId/offers
POST   /projects/:projectId/offers  (solo admin)
PUT    /offers/:id                  (solo admin)
DELETE /offers/:id                  (solo admin)
POST   /offers/:id/copy             (solo admin)
GET    /offers/:id/lines
POST   /offers/:id/lines            (solo admin; aggiunge riga fase)
PUT    /offer-lines/:id             (solo admin)
DELETE /offer-lines/:id             (solo admin)
PUT    /offer-lines/:id/order       (solo admin)
```

### Issues
```
GET    /projects/:projectId/issues
POST   /projects/:projectId/issues  (solo admin)
PUT    /issues/:id                  (solo admin)
DELETE /issues/:id                  (solo admin)
POST   /issues/:id/create-task      (solo admin; crea un'attività dal issue e la collega tramite linked_task_id)
PUT    /issues/:id/link-task        (solo admin; collega un'attività esistente all'issue)
```

### Project Updates
```
GET    /projects/:projectId/updates
POST   /projects/:projectId/updates (admin e resource se assegnata al progetto)
PUT    /project-updates/:id         (solo autore o admin)
DELETE /project-updates/:id         (solo autore o admin)
```

### Plants (Stabilimenti)
```
GET    /plants
POST   /plants                      (solo admin)
PUT    /plants/:id                  (solo admin)
DELETE /plants/:id                  (solo admin)
```

### Templates
```
GET    /templates
POST   /templates                   (solo admin)
PUT    /templates/:id               (solo admin)
DELETE /templates/:id               (solo admin)
POST   /templates/:id/apply         (solo admin; crea progetto da template)
```

### Notifications
```
GET    /notifications               (solo le proprie)
PUT    /notifications/:id/read
PUT    /notifications/read-all
```

### Settings (solo admin)
```
GET    /settings
PUT    /settings/:key
```

### Import / Export
```
GET    /export                      (solo admin; JSON completo)
POST   /import                      (solo admin; replace o merge)
GET    /export/project/:id/markdown (solo admin)
```

### Calcoli / Utilità
```
POST   /utils/calculate-end-date    (calcola data fine da start+durata+risorse)
POST   /utils/check-conflicts       (verifica conflitti prima del salvataggio)
GET    /utils/warnings              (lista avvisi sistema: overload, scaduti, ecc.)
```

---

## 6. Frontend – Struttura e Navigazione

### Layout Generale
- Header fisso con: logo/nome app, nome utente loggato, badge notifiche (campanella), pulsante logout.
- Sidebar (o tab-bar su mobile) con i menu disponibili in base al ruolo.
- Area contenuto principale.
- Supporto tema chiaro/scuro (CSS variables, toggle in header, preferenza salvata per utente).
- Cambio Lingua dell'interfaccia (toggle tra Italiano e Inglese).

### Navigazione per Ruolo

**Admin** – menu completo:
> Dashboard · Risorse · Festività · Progetti · Template · Riunioni · Bacheca · Offerte · Gantt · Vista Risorse · Avvisi · Revisione Attività · Stabilimenti · Mappa Attività · Annotazioni · Calendario Controlli · Utenti · Import/Export · Guida

**Resource** – menu limitato:
> I Miei Progetti · Richiedi Ferie/Permessi · Le Mie Richieste · Notifiche · Guida

---

## 7. Funzionalità Esistenti da Portare

### 7.1 Gestione Risorse

**Vista admin**: tabella risorse con colonne Nome, Ruolo, Reparto, Colore, Icona, Visibilità, Ordine, Azioni (modifica, elimina).
- Pulsante "Aggiungi Risorsa" apre modal con campi: Nome, Cognome, Ruolo, Reparto, Colore (color picker), Icona (emoji), Ore giornaliere da contratto (default 8), Giorni lavorativi settimanali (checkbox Lun–Dom, default Lun–Ven).
- Ogni riga espandibile per vedere assenze e permessi della risorsa.
- Pulsanti freccia su/giù per riordinare le risorse (aggiorna `sort_order`).
- Toggle visibilità per nascondere/mostrare la risorsa nelle viste.
- Sezione "Tipi Risorsa" (settings): CRUD per i tipi di ruolo (nome + colore).
- **Inserimento assenze** direttamente dal profilo risorsa: data inizio, data fine, tipo (ferie/malattia/permesso/altro), note.
- **Inserimento permessi orari** dal profilo risorsa: data, ora inizio, ora fine.
- **Anteprima calendario assenze** nella modal risorsa: visualizzazione mensile con colori per tipo assenza.
- **Verifica sovrapposizioni**: al salvataggio di un'assenza, avvisare se l'assenza impatta attività assegnate alla risorsa.

### 7.2 Gestione Festività

- Visualizzazione festività nazionali italiane calcolate per anno corrente e successivo (algoritmo lato backend: Capodanno, Epifania, Pasqua, Pasquetta, 25 Aprile, 1 Maggio, 2 Giugno, 15 Agosto, 1 Novembre, 8 Dicembre, Natale, Santo Stefano).
- CRUD festività locali: nome, data, stabilimento associato (opzionale).
- Le festività influenzano il calcolo delle date nelle attività (vedi 7.4).

### 7.3 Gestione Progetti

**Vista admin**: tabella progetti con colonne Codice, Nome, Cliente, Stato (badge colorato), Data Inizio, Data Fine, % Completamento (calcolata dalla media delle attività), Azioni.
- Filtri rapidi: stato, cliente, testo libero.
- Pulsante "Nuovo Progetto" apre modal con campi: Nome*, Descrizione, Codice, Cliente, Data Inizio, Data Fine, Stato.
- **Dettaglio Progetto**: pagina/pannello con tab interni:
  - **Attività**: tabella attività del progetto (vedi 7.4)
  - **Milestone**: lista milestone (vedi 7.5)
  - **Riunioni**: riunioni associate al progetto (vedi 7.14)
  - **Offerte**: offerte/preventivi (vedi 7.15)
  - **Issue**: problemi (vedi 7.16)
  - **Aggiornamenti**: log aggiornamenti (vedi 7.17)
  - **Info Generali**: editor Markdown per note estese
  - **Commenti**: feed commenti con menzioni (vedi 8.3)
- Badge di riepilogo nel dettaglio progetto: n. attività, % completamento, n. issue aperte, n. milestone completate.
- **Statistiche progetto**: giorni totali, giorni rimanenti, giorni scaduti, n. risorse coinvolte.
- **Calcolo automatico date progetto** dai task estremi (min start, max end delle attività).

### 7.4 Gestione Attività (Task)

**Modal nuova/modifica attività** con campi:
- Nome* (testo)
- Stato (enum)
- Data Inizio
- Data Fine
- Durata (ore lavorative) – campo calcolabile
- Durata Stimata / Baseline (ore, modificabile manualmente; non si aggiorna con i ricalcoli automatici)
- % Completamento (slider 0–100)
- Tipo Sede: Sede / Cliente / Remoto
- Stabilimento (dropdown se tipo = Cliente)
- Data Flessibile (checkbox)
- Sabato / Domenica / Festivi lavorativi (checkbox triplo)
- Risorse assegnate: lista slot con risorsa + % carico + ore assegnate (opt.) + data inizio slot (opt.) + data fine slot (opt.); ogni risorsa può avere più slot; default = intera durata del task; con N risorse assegnate la durata stimata mostrata = ore totali task / N
- Dipendenza start / end su altra attività (dropdown)
- Milestone collegata (dropdown)
- Annotazione (testo breve)
- Note (editor Markdown con preview)

**Algoritmo calcolo date**:
- Tre modalità: calcola Data Fine da (Inizio + Durata in ore), calcola Durata da (Inizio + Fine), calcola Data Inizio da (Fine + Durata in ore).
- L'algoritmo converte le ore in giorni lavorativi usando le ore contrattuali delle risorse assegnate (`hours_per_day`), saltando: weekend (salvo flag), festività (salvo flag), assenze delle risorse assegnate.
- **Stima multi-risorsa**: con N risorse assegnate, la durata percepita per risorsa = ore totali task / N.
- Il risultato è ricalcolato in tempo reale al cambio dei parametri.

**Tabella attività nel dettaglio progetto**: colonne Nome, Stato, Date, Durata, Risorse, Completamento, Annotazione, Azioni (modifica, elimina, dividi, copia).
- Filtri: testo, stato, risorsa.
- Clic su riga espande le note.

**Split attività**: modal che permette di dividere un'attività in 2 o N parti con anteprima delle date risultanti.

**Copia attività**: modal per copiare un'attività su un altro progetto (con o senza risorse assegnate).

**Chiusura parziale attività**: pulsante "Chiudi Parzialmente" sulla riga dell'attività. Apre un modal con:
- Indicazione delle ore già lavorate / ore residue (calcolato da % completamento × durata).
- Campo % lavoro completato modificabile.
- Al conferma: marca l'attività corrente come `completata` con la % indicata; crea automaticamente una nuova attività con le stesse proprietà (nome suffisso “ – continuazione”), le ore residue come durata, data inizio = giorno successivo alla data fine della corrente, `parent_task_id` = id dell'attività originale.

**Invio email attività**: genera link `mailto:` ccopiando il riepilogo attività precompilato negli appunti in formato html dal markdown.

### 7.5 Gestione Milestone

Lista milestone per progetto con campi: Nome, Data, Note, Completata (checkbox).
- Modal modifica con validazione data.
- Evidenza visiva nel Gantt e nel Calendario Controlli.
- Stato "scaduta" calcolato automaticamente se data < oggi e non completata.

### 7.6 Gantt Chart

Visualizzazione interattiva su timeline CSS Grid.

**Modalità: Per Progetti**
- Una riga per progetto, con barra aggregata durata.
- Sotto ogni progetto: righe attività con barra proporzionale alla durata.
- Colori: per stato attività.
- Milestone come diamante sulla timeline.
- Indicatore "Oggi" (linea verticale rossa).

**Modalità: Per Risorse**
- Una sezione per risorsa.
- Barre attività colorate per progetto.
- Sovrapposizioni visibili (conflitto se barre si sovrappongono per la stessa risorsa).
- Periodi di assenza evidenziati in grigio.

**Controlli Gantt**:
- Navigazione temporale: mese corrente, settimana, mese, trimestre, anno.
- Zoom in/out.
- Filtro per progetto, per risorsa, per stato.
- Toggle weekend sul Gantt.

### 7.7 Bacheca Kanban

6 colonne con drag & drop (o pulsanti di spostamento su mobile):
1. **In Ritardo** – attività con data fine < oggi e non completate
2. **Da Avviare** – status `da-avviare`
3. **In Corso** – status `in-corso`
4. **In Pausa** – status `pausa`
5. **Non Assegnate** – attività senza risorse
6. **Annullate** – status `annullata`

Ogni card mostra: nome attività, progetto, risorsa/e (avatar), data fine, % completamento, badge status.
- Filtri: progetto, risorsa.
- Drag & drop tra colonne aggiorna lo status nel DB (solo admin).

### 7.8 Vista Risorse (Timeline)

Vista orizzontale per risorsa: mostra tutte le attività assegnate su una timeline settimanale/mensile.
- Ogni cella mostra il % di carico della risorsa in quel giorno.
- Colori: verde (≤80%), giallo (81–100%), rosso (>100% = overload).
- Assenze in grigio con icona.
- Festività in grigio chiaro.
- Toggle: vista per settimana / mese.
- Filtro per risorsa (mostra/nascondi singole risorse).
- Risorsa può collassare la propria riga.
- **Suggerimenti di pianificazione**: indicazione dei periodi liberi per risorsa.

### 7.9 Dashboard Giornaliera

Vista riassuntiva della giornata corrente. Sezioni:

- **Attività di oggi**: lista attività in corso che includono la data odierna, con risorsa e progetto.
- **Milestone di oggi**: milestone con data = oggi.
- **Riunioni di oggi**: riunioni schedulate per oggi.
- **Risorse in sede / in trasferta / assenti**: contatore per tipo locazione.
- **Attività in ritardo**: attività con data fine < oggi non completate.
- **KPI progetto**: grafico a torta stati attività (da avviare / in corso / completate / in pausa / annullate).
- **Attività senza risorse**: elenco attività non assegnate.
- **Prossime milestone**: le 5 milestone più vicine.

### 7.10 Pagina Avvisi

Lista avvisi generati dal sistema, divisi per categoria:

| Categoria | Condizione |
|---|---|
| Risorsa sovraccarica | Carico totale risorsa > 100% in un giorno |
| Conflitto assegnazione | Due attività sovrappongono date per la stessa risorsa al 100% |
| Attività scaduta | data fine < oggi, status ≠ completata/annullata |
| Attività senza risorsa | Attività in corso o da avviare senza risorse assegnate |
| Assenza con impatto | Assenza risorsa cade in periodo di attività assegnata |
| Data inizio mancante | Attività senza data inizio |
| Milestone scaduta | Milestone non completata con data < oggi |
| Issue critica aperta | Issue con severity = critica e status ≠ chiusa |

Ogni avviso ha: icona severità, descrizione, link all'entità correlata, pulsante "Ignora" (nasconde per la sessione).

### 7.11 Revisione Attività

Tabella globale di tutte le attività di tutti i progetti, con colonne:
- Progetto, Nome Attività, Stato, Risorse, Data Inizio, Data Fine, Durata, Durata Stimata, Completamento, Sede, Annotazione, Milestone Collegata.

Filtri multipli: progetto, stato, risorsa, intervallo date, testo.  
Ordinamento su ogni colonna.  
Export CSV (solo admin).

### 7.12 Annotazioni Attività

Vista indicizzata di tutte le annotazioni (`annotation` delle attività non vuote).
- Raggruppa per progetto.
- Filtro testo libero.
- Link diretto all'attività.

### 7.13 Gestione Template

- Salva un progetto esistente come template (con le sue attività e milestone, senza risorse assegnate e senza date assolute, solo durate relative).
- CRUD template: lista, anteprima struttura, modifica nome/descrizione, elimina.
- "Applica template": crea un nuovo progetto pre-popolato dalla struttura del template con data inizio da selezionare; le date delle attività sono ricalcolate dalla data inizio inserita.
- **Template Milestone**: salva/carica milestone template separatamente.
- **Template Task**: salva/carica singole attività template.

### 7.15 Offerte (per Progetto)

- Lista offerte per progetto con: nome, data, valore totale (calcolato dalla somma delle righe o inserito manualmente), stato (bozza/inviata/accettata/rifiutata), note.
- **Righe offerta (fasi)**: ogni offerta contiene N righe con descrizione fase, ore stimate e costo orario opzionale. Il valore totale è calcolabile automaticamente dalla somma (ore × costo unitario) di tutte le righe.
- Modal modifica offerta con gestione inline delle righe fase (aggiunta, modifica, eliminazione, riordino drag-and-drop).
- Copia offerta su altro progetto.
- Vista globale offerte (tab "Offerte" in menu admin): tabella di tutte le offerte, filtrabile per progetto/stato/cliente.
- KPI offerte nella dashboard: totale valore offerte attive.

### 7.16 Issue (per Progetto)

- Lista issue per progetto con: titolo, descrizione, severità (badge colorato), stato, attività collegata (link se presente), data scadenza.
- Modal modifica issue.
- **Crea attività da issue**: pulsante nella modal issue che crea un'attività nel progetto corrente pre-compilata con il titolo dell'issue; l'attività creata viene collegata tramite `linked_task_id`. L'issue passa automaticamente a status `in-corso`.
- **Collega attività esistente**: possibilità di collegare manualmente un'attività già esistente a un'issue tramite dropdown.
- Filtro per stato e severità.
- Issue critiche aperte appaiono negli Avvisi.

### 7.17 Aggiornamenti Progetto

- Log cronologico di aggiornamenti testuali (Markdown) per progetto.
- Admin e resource assegnate al progetto possono aggiungere aggiornamenti.
- Ogni aggiornamento mostra: autore, data, titolo (opzionale), contenuto.
- Modifica/eliminazione solo da autore o admin.

### 7.18 Gestione Stabilimenti (Plants)

- CRUD stabilimenti di due tipi: **Sede Aziendale** (sedi proprie dell'azienda che usa il software) e **Sede Cliente** (stabilimenti/uffici dei clienti).
- Campi: tipo, nome, cliente (solo se tipo = Cliente), indirizzo, coordinate GPS (lat/lng), note.
- **Geocoding**: al salvataggio dell'indirizzo, chiamata a Nominatim (OpenStreetMap, no API key richiesta) per ottenere le coordinate.
- Vista lista separata per tipo, con link a Google Maps per ogni stabilimento.
- **Festività locali**: le festività locali possono essere associate sia a sedi aziendali che a sedi cliente (es. festività regionali della sede).
- Le sedi aziendali e le sedi cliente sono selezionabili nelle attività in base al tipo locazione scelto (Sede / Cliente).

### 7.19 Mappa Attività

Vista geografica (Leaflet) che mostra:
- Marker per ogni stabilimento con attività "flessibili" o "da pianificare" assegnate.
- Popup con lista attività per stabilimento, risorse assegnate, date.
- Filtro per risorsa.
- Solo attività con `flexible_date = true` e tipo locazione = `cliente`.

### 7.20 Calendario Punti di Controllo

Vista calendario milestone.
- Modalità settimana e mese.
- Ogni milestone appare nel giorno corrispondente con: nome, progetto, stato (completata/scaduta/futura).
- Navigazione mese/settimana precedente/successiva.
- Click su milestone apre il dettaglio.

### 7.21 Import / Export

**Export** (solo admin):
- Esporta tutti i dati in JSON (stesso schema dell'app attuale per compatibilità).
- Esporta singolo progetto in Markdown formattato.
- Esporta piano ferie in PDF (generazione lato client con stampa browser).

**Import** (solo admin):
- Carica file JSON esportato dalla versione precedente (single-file app con IndexedDB).
- Due modalità: **Sostituisci** (cancella tutto e sostituisce) e **Unisci** (merge per ID, skippa duplicati).
- Preview del contenuto prima dell'import con conteggio oggetti per tipo.
- **Compatibilità**: il formato JSON dell'app esistente (con i campi `resources`, `projects`, `tasks` nidificati, `templates`, `meetings`, `plants`, `localHolidays`) deve essere riconosciuto e importato correttamente, mappando i campi al nuovo schema DB.

---

## 8. Nuove Funzionalità

### 8.1 Portale Risorsa (Vista Limitata)

L'utente con ruolo `resource` vede dopo il login una schermata "I Miei Progetti" che mostra:

**Lista progetti assegnati**: solo i progetti in cui la risorsa ha almeno un'attività assegnata.
- Per ogni progetto: nome, cliente, stato (badge), date, % completamento globale del progetto.
- Click sul progetto apre il **Dettaglio Progetto** in sola lettura (admin può scrivere, resource può solo leggere il gantt e aggiungere commenti/aggiornamenti).

**Dettaglio Progetto (vista risorsa)**:
- Tab **Gantt**: Gantt completo del progetto (tutte le attività, non solo le proprie) in sola lettura. Le attività della risorsa sono evidenziate.
- Tab **Attività**: tabella attività del progetto in sola lettura. Le attività della risorsa sono evidenziate.
- Tab **Milestone**: lista milestone in sola lettura.
- Tab **Commenti**: feed commenti con possibilità di aggiungere commenti e menzioni (vedi 8.3).
- Tab **Aggiornamenti**: log aggiornamenti con possibilità di aggiungere aggiornamenti.

**Nota**: la risorsa vede la pianificazione **completa del progetto**, non solo le proprie attività. Non può modificare nulla (task, milestone, date) ma ha visibilità totale sulla struttura del progetto.

### 8.2 Richiesta Ferie e Permessi

**Flusso richiesta (risorsa)**:
1. La risorsa accede alla sezione "Richiedi Ferie/Permesso".
2. Compila il form: tipo (ferie / permesso orario / malattia / altro), data inizio, data fine (per ferie), ore inizio/fine (per permesso), note opzionali.
3. Invia la richiesta → crea record in `leave_requests` con `status = pending`.
4. Notifica push (WebSocket) + notifica in-app all'admin.
5. La risorsa vede in "Le Mie Richieste" lo storico con stato (in attesa / approvata / rifiutata) e note admin.

**Flusso approvazione (admin)**:
1. L'admin riceve notifica (badge campanella) e può accedere alla lista richieste dalla sezione Risorse o da una sezione dedicata "Richieste Ferie".
2. Visualizza dettaglio richiesta con anteprima delle attività impattate nel periodo richiesto.
3. Approva: crea record in `absences` o `permits`, aggiorna `leave_request.status = approved`, invia notifica alla risorsa.
4. Rifiuta: aggiorna `leave_request.status = rejected`, campo `admin_notes` obbligatorio, invia notifica alla risorsa.

**Vista admin "Richieste Ferie"**:
- Tabella con: risorsa, tipo, date/ore, stato (badge), note, azioni (approva/rifiuta).
- Filtro per stato (pending / approvate / rifiutate), per risorsa, per periodo.
- Contatore badge pending nella navbar.

### 8.3 Commenti con Menzioni alle Attività

**Dove appaiono i commenti**:
- Ogni attività ha un tab/sezione "Commenti" accessibile dal dettaglio attività.
- Visibili sia ad admin che a resource assegnate al progetto.

**Composizione commento**:
- Editor testo con supporto Markdown.
- Meccanismo menzioni: digitando `@` appare autocomplete con lista utenti attivi. Selezionando un utente viene inserito `@nomecognome` (tag cliccabile).
- Pulsante "Invia".

**Backend**:
- Al salvataggio del commento, il server:
  1. Salva il commento in `task_comments`.
  2. Individua le menzioni nel testo (pattern `@nomecognome`, match su `users.first_name + last_name`).
  3. Per ogni utente menzionato: crea record in `comment_mentions` e record in `notifications` con `type = mention`.
  4. Se il task è assegnato a una risorsa che non è l'autore del commento: crea notifica `type = task_assigned` (opzionale, configurabile).
  5. Push WebSocket agli utenti coinvolti.

**Visualizzazione commenti**:
- Feed cronologico con: avatar autore (colore risorsa), nome autore, data/ora (relativa: "2 ore fa"), contenuto Markdown renderizzato, menzioni come badge cliccabili.
- Pulsante modifica (solo autore, entro 24h) e elimina (autore o admin).
- Indicatore "modificato" se il commento è stato editato.

**Centro Notifiche**:
- Campanella in header con badge contatore notifiche non lette.
- Click apre pannello notifiche con lista: tipo, messaggio, link alla risorsa correlata, data.
- "Segna tutte come lette".
- Le notifiche arrivano in real-time via WebSocket senza ricaricare la pagina.

---

## 9. UI / UX

### Design System
- **Stile**: clean, professionale, coerente con l'app attuale. Non usare framework CSS di terze parti (Bootstrap, Tailwind, ecc.). CSS custom con variabili.
- **Tema**: chiaro (default) e scuro. Toggle in header. Preferenza salvata per utente nel DB.
- **Font**: sistema operativo (font stack sans-serif nativo).

### Responsive
- **Desktop** (≥1200px): sidebar verticale espansa, layout a colonne.
- **Tablet** (768–1199px): sidebar collassabile (icone), layout a colonne ridotte.
- **Mobile** (<768px): bottom navigation bar, viste single-column, modali full-screen.

### Accessibilità
- Semantic HTML (landmark roles).
- ARIA labels su elementi interattivi.
- Focus management nelle modali (focus trap).
- Contrasto colori WCAG AA.
- Navigazione da tastiera.

### Feedback Utente
- Toast notifications per conferma operazioni (salvataggio, errore, ecc.).
- Loading spinner durante chiamate API.
- Stato empty-state illustrato per liste vuote.
- Conferma dialogo prima di eliminazioni.

### Modali
- Pattern: `openXModal(id?)` / `closeXModal()`.
- Chiusura con tasto ESC e click fuori dalla modal.
- Scroll interno se contenuto supera altezza viewport.

### Colori Status
- Verde (#4CAF50): completata, approvata, in corso positivo
- Arancione (#FFA726): in pausa, permesso, avviso
- Rosso (#F44336): scaduta, rifiutata, critica, overload
- Blu (#2196F3): da avviare, info, flessibile
- Grigio (#9E9E9E): annullata, assente, disabilitato
- Viola (#7B1FA2): assenza pianificata

---

## 10. Deployment e Configurazione Server

### Struttura del Progetto
```
/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── middlewares/
│   │   ├── services/
│   │   └── utils/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── views/
│   │   ├── components/
│   │   ├── stores/
│   │   ├── router/
│   │   └── assets/
│   └── package.json
├── docker-compose.yml
└── README.md
```

### File `.env` (backend)
```
DATABASE_URL=postgresql://user:password@localhost:5432/projectplanner
JWT_SECRET=<stringa casuale ≥ 64 caratteri>
JWT_REFRESH_SECRET=<altra stringa casuale ≥ 64 caratteri>
PORT=3000
NODE_ENV=production
CORS_ORIGIN=http://your-server-ip-or-domain
```

### Docker Compose
Fornire un `docker-compose.yml` pronto all'uso con:
- Servizio `db`: PostgreSQL con volume persistente.
- Servizio `backend`: Node.js app.
- Servizio `frontend`: Nginx che serve la SPA compilata e fa proxy delle richieste `/api/*` al backend.

### Script di Avvio
- `npm run dev` (backend): avvia con nodemon.
- `npm run build` (frontend): compila la SPA.
- `npm run migrate`: esegue `prisma migrate deploy`.
- `npm run seed`: popola il DB con dati iniziali (utente admin default con credenziali configurabili da ENV).

### Sicurezza
- HTTPS: la configurazione Nginx deve includere istruzioni per certificato SSL (Let's Encrypt o self-signed per rete locale).
- Rate limiting: max 100 req/min per IP sull'intera API; max 5 req/min su `/auth/login`.
- Helmet.js per header HTTP di sicurezza.
- CORS configurato solo per l'origin del frontend.
- Tutti gli input validati con Zod prima di raggiungere il DB.
- Nessun dato sensibile nei log.
- Prisma usa query parametrizzate (SQL injection prevention nativa).

### Primo Avvio
1. Configurare `.env` dal template `.env.example`.
2. Eseguire `docker-compose up -d` (o avvio manuale).
3. Eseguire `npm run migrate` per creare lo schema DB.
4. Eseguire `npm run seed` per creare l'utente admin iniziale.
5. Accedere a `http://server:porta`, effettuare login con le credenziali dell'admin iniziale e cambiare subito la password.

### Compatibilità Import
Alla prima configurazione, l'admin deve poter importare il file JSON esportato dall'app attuale (single-file con IndexedDB) tramite la funzione Import, in modo da migrare tutti i dati esistenti nel nuovo DB PostgreSQL senza perdite.

---

*Fine del prompt. Ogni sezione è autonoma e ottimizzabile separatamente prima di procedere con l'implementazione.*
