# Istruzioni per la generazione dei messaggi di commit

Scrivi SEMPRE il messaggio di commit in ITALIANO.

Analizza il contenuto effettivo del diff di OGNI file prima di scrivere qualsiasi descrizione.
NON dedurre i cambiamenti dai nomi dei file o dai percorsi: descrivi solo ciò che è realmente cambiato nel codice.

---

## PASSO 1: IDENTIFICA FILE AGGIUNTI ED ELIMINATI

PRIMA di qualsiasi altra analisi, verifica se ci sono file aggiunti o eliminati nella staging area.
Questi sono SEMPRE la modifica più importante e devono apparire in cima al messaggio.
Non saltare mai questo passo. Se non ce ne sono, non scrivere la riga.

---

## PASSO 2: FILTRA I CAMBIAMENTI DA IGNORARE

Nei file modificati, rimuovi completamente dalla tua analisi i seguenti elementi.
NON menzionarli mai, nemmeno di passaggio, nemmeno raggruppati:

- Righe `&REL`, `&ACCESS`, `&COMMENT` — header auto-generati dal robot KUKA
- Variazioni di coordinate/posizioni inferiori a 1 mm o 1 grado
- Timestamp, contatori, GUID auto-generati
- Cambiamenti solo di formattazione (spazi, indentazione)

---

## PASSO 3: IDENTIFICA LE MODIFICHE FUNZIONALI REALI

Analizza il diff effettivo di ogni file rimasto. Raggruppa per sottosistema o cartella.
Ogni gruppo deve descrivere SOLO le modifiche effettivamente presenti in quei file,
senza attribuire cambiamenti da altri gruppi.

**Per programmi robot KUKA (.src, .dat):**
- Nuove/rimosse funzioni DEF/DEFFCT
- Logica del programma cambiata
- Nuove chiamate a sottoprogrammi
- Variabili cambiate
- Variazioni di quote superiori a 1 mm o 1 grado

**Per altri brand di robot (ABB RAPID, Fanuc TP, Yaskawa INFORM, ecc.):**
- Flusso del programma
- Assegnazioni I/O
- Cambiamenti di tool/frame

**Per C#, Python, JS/TS e altro codice:**
- Modifiche di logica
- Cambiamenti API
- Nuovi metodi/classi
- Bugfix

**Per file JSON, XML, YAML, INI:**
- Modifiche significative di parametri
- Nuove/rimosse voci

---

## PASSO 4: VALUTA L'IMPORTANZA E SCRIVI IL MESSAGGIO

Se dopo i passi 1-3 non rimane nessuna modifica funzionale reale, scrivi:

⚠️ Commit minore — nessuna modifica funzionale
- Solo sincronizzazione &REL / &ACCESS / coordinate minori

Altrimenti usa questo formato:

- **Titolo** breve (max 72 caratteri) che riflette la modifica più importante
- `[-]` file eliminati (se presenti, sempre in cima)
- `[+]` file aggiunti (se presenti)
- `[M] NomeGruppo (N file)` — solo se ci sono modifiche funzionali reali nel gruppo, con descrizione basata sul diff reale
- Ometti i gruppi dove sono cambiati solo elementi ignorati