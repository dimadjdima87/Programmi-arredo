# Validazione 0.5.0 — planimetrie

- 31 test API: persistenza CAD, coordinate e limiti; regressioni progetti e catalogo.
- Build standalone Next e controllo TypeScript riusciti.
- 7 test frontend riusciti: DWG reale, DXF in metri con origine negativa,
  conversione assi, salvataggio/riapertura, annulla/ripristina, blocchi e archi,
  chiusura catalogo e regressioni dello studio.
- 4 test runtime desktop riusciti senza skip: payload nativo, browser, riavvio,
  backup e ripristino.
- Finestra Electron Linux verificata con lettura del vero DWG e importazione;
  CSP dedicata al worker, senza abilitare eval nel renderer principale.
- Il collaudo Windows installerà e avvierà il programma e importerà lo stesso
  DWG anche nella finestra installata. Vedere lo stato della build Windows.

Le prove usano un fixture CAD pubblico LibreDWG; non costituiscono una verifica
di compatibilità con i DWG reali dello studio, che andranno provati.

---

# Verifiche — 21 ottobre 2026

## Risultati

- Backend: **13 test passati su SQLite** e **13 su PostgreSQL 17**.
- Frontend: **2 test Playwright passati**, inclusa la sequenza end-to-end reale.
  Eseguiti sia con server di sviluppo sia con build di produzione; ripetuti
  sull'applicazione Compose con PostgreSQL.
- Next.js 16.4.2: build di produzione e controllo TypeScript riusciti.
- Build delle immagini API e web riuscita; Compose avviato con database sano.
- Login e richieste di progetto tramite proxy Next, non soltanto verifica porte.

## Copertura effettiva

API: autenticazione/logout, isolamento fra utenti su lettura/scrittura/versioni/
ripristino, persistenza senza deriva, revisione concorrente 409, ripristino
immutabile, aperture fuori muro/sovrapposte/inesistenti, perimetro intersecante,
NaN, ID duplicati, altezza apertura, lock, finiture isolate e seed ripetibile.

Browser: cucina 4200 × 3600, porta/finestra, mobile DEMO, undo/redo di aggiunta,
movimento e rotazione, salvataggio/rilettura API, due moodboard, cambio palette,
approvazione, revisione 2, ripristino versione 1 come revisione 3. Export PNG
verificato nella firma e nelle dimensioni dell'immagine; export JSON confrontato
con la scena salvata. Nessun errore JavaScript nella sequenza completata.

## Problemi iniziali risolti

- Cache npm e configurazione Docker nella home non scrivibili: cache in /tmp o
  /workspace e DOCKER_CONFIG locale.
- Download browser vietato dal proxy: usato Chromium già installato, nessuna
  verifica disabilitata. CI standard installa il browser Playwright.
- Origine dev Next bloccata: configurato esplicitamente 127.0.0.1.
- Build Docker senza DNS/CA del proxy: helper con risoluzione proxy e CA fornita
  dall'ambiente montata come build secret. TLS rimane verificato.
- Test iniziale selezionava per titolo un precedente progetto DEMO: corretto
  usando l'ID restituito dalla creazione della sessione corrente.

## Limiti della verifica

Una deprecazione di Starlette/AnyIO nel TestClient non fa fallire i test.
CI GitHub predisposta ma non eseguita su GitHub in questa sessione.
Nessuna pubblicazione cloud o ripristino in un nuovo task verificati.
Le funzionalità di fase 2–5 non sono implementate né dichiarate verificate.

## Incremento catalogo — 22 ottobre 2026

- **20 test API passati su SQLite e 20 su PostgreSQL 17**.
- **3 test frontend passati**, inclusi due percorsi E2E: editor originale e nuovo
  catalogo → CSV → campione → prodotto in pianta → finitura → moodboard.
- Next.js: build di produzione e typecheck riusciti; immagini API/web ricostruite
  e applicazione Compose/PostgreSQL avviata con il volume campioni persistente.
- E2E ripetuti sull'applicazione Docker finale: tutti e tre passati.

Nuove verifiche API: approvazione con provenienza/diritti obbligatori, versioni e
conflitti catalogo, isolamento utenti, snapshot storici dopo archiviazione,
rifiuto riferimenti alterati, fedeltà dimensioni dei prodotti reali, compatibilità
finiture, importazione CSV atomica/duplicati, upload immagini valido/non valido e
limite dimensione, download campioni privato, suggerimenti con soli ID approvati,
riferimenti moodboard e migrazione idempotente senza perdita delle scene fase 1.

Il browser ha verificato caricamento binario del PNG attraverso Next, inserimento
di un prodotto CSV approvato, finitura con conservazione di identità, misure e
posizione, due moodboard con provenienza rules-demo e salvataggio delle referenze.
La regressione sul tab Brief dopo ricaricamento è stata corretta e ritestata.

Le integrazioni IA esterne e dati commerciali reali non sono state testate:
nessun provider o catalogo autorizzato è stato fornito. Il mock è dichiarato.
La bozza cloud è aggiornata; questo incremento non è stato pubblicato dall'agente.

## Desktop Windows — preparazione 0.3.0 (22 ottobre 2026)

Verificato sul cloud Linux:

- **22 test API SQLite passati**, inclusi protezione delle porte locali e
  disattivazione dell'accesso automatico nella versione web.
- **4 test desktop passati, zero saltati**, con backend realmente compilato
  PyInstaller, Next standalone e Node incluso in Electron. Verificati avvio,
  rifiuto richieste senza chiave, sessione locale, progetto, campione, riavvio,
  copia di backup e apertura effettiva dei dati recuperati.
- Nel test desktop il browser Chromium ha usato solo l'origine locale, creato
  e salvato un progetto senza inserire password, senza errori JavaScript.
- **3 test frontend web passati**: conservato il flusso web precedente.
- Build standalone e TypeScript riusciti.
- Finestra Electron reale avviata e salvataggio verificato in modalità headless.
  Controllato `typeof require === 'undefined'` nel renderer.
- Pacchetto Linux electron-builder con ASAR generato e avviato, compresi i servizi
  Python/Next dalle risorse confezionate. Salvataggio riuscito anche nel pacchetto.

Problemi iniziali risolti: download Electron tramite proxy/CA esistenti;
controllo dell'origine locale basato sull'header Host effettivo anziché URL
interno Next; inclusione dei node_modules standalone nel payload electron-builder.
La prova GUI Linux usa un profilo temporaneo con cache scrivibile e flag headless
specifici del contenitore (sandbox Chromium disabilitata solo per tale prova).
La configurazione distribuita mantiene `sandbox: true`; il collaudo Windows
predisposto non passa quei flag.

**Non eseguiti:** workflow GitHub Windows, compilazione `.exe` Windows, installer
NSIS su Windows, firma editore, SmartScreen, aggiornamento/disinstallazione.
Il workflow è predisposto ma non è stato avviato né è stata pubblicata una release.
Il pacchetto Linux non viene presentato come programma installabile Windows.

## Build e collaudo Windows effettivi — 22 ottobre 2026

Le verifiche Windows precedentemente indicate come non eseguite sono ora passate:

- Run: https://github.com/dimadjdima87/Programmi-arredo/actions/runs/39757995309
- Commit applicativo: 5a171821bacf841a4666ed114d8ea19a80446af8.
- Stato finale GitHub: **Success**, durata 4 minuti e 41 secondi.
- Build nativa Python, Next standalone e installer NSIS x64: passata.
- Test del payload con browser, backup e recupero: passati.
- Finestra Electron prima dell'installazione: passata.
- Installazione silenziosa Windows e avvio/salvataggio del programma installato:
  passati.
- Artifact caricato: `Albertelli-Design-Studio-Windows-x64`, 134 MB,
  ID 12417356212, contenente installer e SHA256.txt.
- Digest SHA-256 dell'artifact pubblicato da GitHub:
  `1e82b13723819fba9d4ab9376e5bf3e1d3ee474193da46422f0fc85d0c9a57bd`.

Esito osservato nelle pagine ufficiali GitHub del run e del job. Il warning
Node 20 riguarda le versioni delle action, forzate da GitHub a Node 24; non ha
fatto fallire build o test. Nessuna firma editore e nessuna GitHub Release creata:
l'installer è distribuito come artifact del workflow, con accesso GitHub.

## Correzione rientro desktop 0.3.1 — 22 ottobre 2026

Il pulsante Esci nella 0.3.0 mostrava il login DEMO web, inutilizzabile con
l'identità locale del desktop. Ora il client riconosce la modalità dall'health
protetto e presenta Rientra nello studio senza campi o password DEMO. Il login
web resta disponibile nella modalità web. Logout ripulisce anche lo stato locale.

- 22 test API SQLite passati e controllo TypeScript riuscito.
- 4 test desktop passati con payload compilato, incluso reload con cookie valido,
  logout, assenza campi password e rientro con progetti ancora presenti.
- Smoke test Electron locale passato con uscita/rientro.
- Build Windows e collaudo del programma installato passati, inclusa la nuova
  regressione logout/rientro:
  https://github.com/dimadjdima87/Programmi-arredo/actions/runs/39776642545
- Commit applicativo: 36cdd71. Installer versione 0.3.1 disponibile come artifact.

Nessuna migrazione DB o modifica ai percorsi dei dati. Il test Windows è passato
sul pacchetto generato; l'aggiornamento della specifica installazione dell'utente
non è stato eseguito dall'agente. Conservare un backup prima di aggiornare.
# Catalogo di riferimento cucine — 22 ottobre 2026

Pacchetto privato generato fuori dal repository da manuale SHA-256
`ce4a42c404d6c41565d523d1c2ad08f116dbcc4318f6c85dbfcdb34dcecdd2c4`.
Inventario di 1.086 pagine, 901 incluse nella consultazione cucina; 185 differite.
8.870 occorrenze, comprese varianti e ripetizioni; non sono 8.870 mobili distinti.
7.749 stringhe codice distinte, con numero maniglia e codice supplemento separati.

- 74.557 celle concordi tra PyMuPDF e Poppler, inclusi trattini di indisponibilità.
- 4 celle grafiche a zero verificate nelle pagine originali 188 e 189,
  registrate come controllo visivo, senza attribuire concordanza testuale.
- 13 occorrenze di regola percentuale del 30%, conservate separatamente dai punti.
- 46 schede maniglia senza punti espliciti; non equiparate a zero/gratuità.
- Nessuna discordanza numerica irrisolta; tutti i dati restano esclusi dal calcolo
  automatico e dall'approvazione commerciale. Compatibilità, geometrie e regole
  applicabili non sono attestati integralmente da questi controlli.
- Audit: hash fonte, inventario, integrità SQLite, FTS5, indisponibilità,
  campione visivo di 29 righe/142 celle; zero errori. Restano due pagine con il
  termine “punti” e senza tabella: informazioni generali (4) e suggerimenti (1081).
- 26 test Python passati: formati numerici, errori, ritaglio PDF, apici, griglie,
  varianti DG, maniglie, evidenza privata e assenza di promozione commerciale.
- Browser Chromium: ricerca, punti, superfici, percentuali, zeri grafici, maniglie,
  note, assenza di dipendenze esterne, testo sicuro e layout stretto verificati.
  Test su loopback perché il browser gestito blocca file://.

La consegna precedente alla 0.4.0 era una biblioteca offline, non un nuovo installer Windows né
un'importazione nel database dell'applicazione. Fonti e pacchetti non pubblicati
su GitHub. Dettagli in [kitchen-catalog-import.md](kitchen-catalog-import.md).

## Biblioteca cucina integrata e Windows 0.4.0 — 22 ottobre 2026

Fonte applicativa: commit `0861079`. Biblioteca privata verificata caricabile dal
programma, categorie e ricerca FTS5, punti/regole/pagine, preferiti e articoli per
progetto con quantità, note, revisione e snapshot. Le pagine aperte da una scelta
restano quelle del dataset conservato, anche dopo un aggiornamento del catalogo.

- 30 test API locali passati; nuova regressione sulla chiusura delle connessioni
  SQLite prima dello spostamento atomico dell'indice su Windows.
- Build frontend e TypeScript passati; 4 test browser web passati, compresi elenco
  progetto, preferiti, note, quantità ed esportazione senza modificare la scena.
- API nativa PyInstaller, frontend standalone e Node di Electron: 4 test senza
  skip con il pacchetto autentico da 8.870 occorrenze, caricamento reale via proxy
  e browser, ricerca, scelte, riavvio e copia di backup riaperta e consultabile.
- Finestra Electron Linux collaudata con profilo e cache scrivibili; import di
  pacchetto errato rifiutato con messaggio leggibile.
- [CI generale riuscita](https://github.com/dimadjdima87/Programmi-arredo/actions/runs/39831053554):
  test API SQLite e PostgreSQL, build/TypeScript e browser tutti riusciti.
- [Windows 0.4.0 riuscito e download](https://github.com/dimadjdima87/Programmi-arredo/actions/runs/39831052749#artifacts):
  30 test API con fixture neutre nel build nativo Windows, generazione NSIS,
  runtime/browser/backup, Electron, installazione silenziosa e collaudo del
  programma installato tutti riusciti. Nessun pacchetto privato trasferito alla CI.

Artifact `Albertelli-Design-Studio-Windows-x64`, id `12449750346`, 134 MB;
installer `Albertelli-Design-Studio-Setup-0.4.0-x64.exe`, con `SHA256.txt`.
Digest dell'artifact:
`a4ce5815f3e2993cbf0beb8e5dc38724c8f0684a6df237da19f94c09b2ae72d8`.

Il catalogo autentico è stato verificato sul runtime Linux compilato; su Windows
la pipeline usa fixture neutre e collauda l'installer e la nuova sezione. Il ZIP
privato viene caricato una volta dall'utente ed entra nei backup locali. Non sono
stati abilitati calcolo costi o inserimento automatico di ingombri non validati.
