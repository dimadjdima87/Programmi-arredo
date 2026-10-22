# Albertelli Design Studio AI — DEMO

Studio locale con interfaccia italiana, cucina 2D, moodboard e biblioteca privata
**Albertelli Kitchen 2026**. La biblioteca comprende codici, varianti, punti e note
del manuale verificato, caricabili dal pacchetto privato dello studio.
Gli arredi geometrici e le proposte moodboard restano DEMO; il catalogo non abilita
ancora inserimento automatico dei mobili reali o calcolo dei costi.

Uso del catalogo, preferiti, articoli per progetto e backup:
[Albertelli Kitchen nel programma](docs/kitchen-in-app.md).

## Struttura

- `frontend/app`: Next.js, editor Konva, schema TypeScript, moodboard e proxy API.
- `backend/main.py`: FastAPI, validazione Pydantic, sessioni, schema SQL e versioni.
- `backend/tests`: test API, geometria e autorizzazioni.
- `frontend/tests`: test browser e invariante finiture.
- `docs`: architettura, milestone, requisiti originali e risultati verifiche.
- `compose.yaml`, Dockerfile, `.github/workflows/ci.yml`: avvio e CI.

## Prerequisiti

Node.js 24, Python 3.12; Docker con Compose per PostgreSQL e avvio containerizzato.
Le dipendenze vengono scaricate durante l'installazione. Dopo la preparazione,
il flusso demo funziona senza servizi IA o connessioni esterne.

Per preparare automaticamente gli strumenti nativi dalla root:

```bash
bash scripts/setup.sh
```

## Avvio completo con PostgreSQL

Dalla root:

```bash
cp .env.example .env
# Modifica .env per eventuali password locali personalizzate.
docker compose up --build -d
```

Apri la porta 3000 nel browser locale. I container API e database non espongono
porte pubbliche. `docker compose logs api web` mostra errori di avvio;
`docker compose down` ferma i servizi mantenendo i dati nel volume.
Non usare `down -v` se vuoi conservare i progetti.

Account: `designer@demo.local` e `viewer@demo.local`.
Password iniziale per entrambi: `DemoStudio2026!` (oppure `DEMO_PASSWORD` al primo
avvio). Il secondo account è un utente demo separato per verificare l'isolamento,
non un ruolo RBAC di sola lettura. Cambiare DEMO_PASSWORD dopo il seed non cambia
le password degli utenti già creati. Questo non è un sistema di accesso pronto
per la produzione: usare solo dati fittizi e non esporre pubblicamente il demo.

In un ambiente cloud con proxy e CA già forniti, la build può essere preparata con:

```bash
BUILDX_CONFIG=/workspace/.buildx python scripts/build-containers.py
docker compose up -d --no-build
```

Il helper usa il proxy esistente e monta il bundle CA come build secret; non
scrive credenziali né disabilita TLS. Il percorso BUILDX_CONFIG conserva la cache build in una directory scrivibile,
senza cambiare configurazione Docker o credenziali dei registry.

## Avvio locale alternativo, senza Docker (SQLite)

Dalla root:

```bash
python -m venv .venv
.venv/bin/pip install -r backend/requirements.lock
npm --prefix frontend ci
npm --prefix frontend run build
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In un secondo terminale, sempre dalla root:

```bash
npm --prefix frontend start
```

Il database SQLite `studio.db` viene creato nella directory di avvio del backend.
Per sviluppo con aggiornamento automatico usare `npm --prefix frontend run dev`
e aggiungere `--reload` a uvicorn. `API_URL` sul processo Next indica il backend;
`DATABASE_URL` sul backend seleziona PostgreSQL o SQLite. Il proxy Next legge
API_URL a runtime. `.env` nella root è letto da Compose; per i processi nativi
impostare le variabili nella shell. Non mettere credenziali in variabili NEXT_PUBLIC.

## Test

Dalla root, dopo l'installazione:

```bash
.venv/bin/pytest backend/tests -q
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Con backend attivo sulla porta 8000 e frontend non avviato, Playwright avvia e
ferma il frontend automaticamente:

```bash
cd frontend
npx playwright install chromium
E2E_PRODUCTION=1 npm test
```

Se Chromium è già installato, usare invece
`CHROMIUM_PATH=/usr/bin/chromium E2E_PRODUCTION=1 npm test`.
Senza E2E_PRODUCTION il test avvia il server di sviluppo. I test browser creano
progetti DEMO nell'istanza API selezionata. Usare un'istanza dedicata ai test.

Per ripetere i test API su PostgreSQL usare un database **dedicato** con `test`
nel nome, poi:

```bash
TEST_DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:5432/studio_test' .venv/bin/pytest backend/tests -q
```

La suite svuota le tabelle del database di test. Non usare un database di lavoro.
SQLite usa una directory temporanea separata a ogni esecuzione.

## Demo guidata

1. Accedi e premi **Nuovo progetto cucina**: stanza 4200 × 3600 mm.
2. Apri **Muri e vertici** per cambiare coordinate; aggiungi porta e finestra.
3. Aggiungi una base dal catalogo DEMO. Trascinala o inserisci X/Y, dimensioni,
   rotazione e finitura nell'ispettore. Il trascinamento aggancia a 50 mm.
4. Prova **Annulla** e **Ripristina**. **Salva progetto** crea una revisione.
5. In **Moodboard** modifica i colori e approva un concept, poi esporta PNG.
6. Salva nuovamente. In **Brief e versioni** ricarica o ripristina una revisione:
   il ripristino crea una nuova versione, senza cancellare la cronologia.
7. Esporta la pianta PNG o il progetto JSON. Gli export indicano revisione e
   modifiche non salvate; la pianta PNG cattura la vista corrente con zoom/pan.

## Limiti noti

- Editor 2D: niente 3D, collisioni, vincoli cucina o certificazioni tecniche.
- Il muro è il segmento dal vertice indicato al successivo. Aperture riferite
  tramite ID stabile. Eliminare/dividere muri può invalidare aperture esistenti:
  riassegnarle o correggerle prima di salvare. Nessuna correzione silenziosa.
- Moodboard procedurali, senza generazione IA, SKU, prezzi o licenze commerciali.
- PNG e JSON; PDF commerciale e importazione JSON non implementati.
- Lock completo degli arredi; sblocco di un elemento salvato richiede un
  salvataggio separato prima di modificarlo. Ripristino versione è esplicito.
- Undo/redo locale (100 stati) distinto dalla cronologia persistente; ricaricando
  si perde la sola cronologia locale. Conflitti fra schede: 409, ricaricare dopo
  aver eventualmente esportato il lavoro locale in JSON.
- Schema SQL iniziale versionato, senza migrazioni incrementali Alembic.
- Nessun upload, cliente reale, RBAC amministrativo, condivisione o audit completo.

Vedi `docs/validation.md` per verifiche eseguite e `docs/milestones.md` per il passo
successivo: cataloghi autorizzati, importazione CSV e provenienza dei materiali.

## Incremento Fase 2: catalogo e materiali

Ora disponibile dalla barra laterale **Catalogo e materiali**: produttori,
prodotti, finiture, approvazione manuale, CSV con verifica preventiva, campioni
PNG/JPEG e prodotti inseribili in pianta. Le moodboard possono usare i riferimenti
approvati del catalogo. Guida completa, contratto CSV e limiti in
[docs/catalog.md](docs/catalog.md).

Dopo l'aggiornamento del codice ricostruire le immagini, senza eliminare volumi:

```bash
BUILDX_CONFIG=/workspace/.buildx python scripts/build-containers.py
docker compose up -d --no-build
```

In locale senza Docker aggiornare le dipendenze con `bash scripts/setup.sh` e
riavviare backend e frontend. La migrazione versione 2 è additiva e automatica.
Il volume `studio-assets` conserva i campioni; in modalità nativa la directory
predefinita è `.studio-assets`. Includere DB e file nei backup insieme.
Il provider IA è ancora il mock dichiarato rules-demo: nessun invio di dati esterno.

## Programma installabile per Windows

È aggiunto il confezionamento desktop Electron per Windows 10/11 x64, senza
hosting, Python o Docker sul computer dell'utente finale. Progetti SQLite e
campioni restano nel profilo Windows; menu per aprire i dati e creare backup.

Guida e stato reale dell'installer: [docs/windows-desktop.md](docs/windows-desktop.md).
La build Windows 0.3.1 è riuscita ed è stata installata e avviata nei test su
Windows. [Scarica dalla build GitHub Actions](https://github.com/dimadjdima87/Programmi-arredo/actions/runs/39776642545#artifacts):
accedi a GitHub, scarica `Albertelli-Design-Studio-Windows-x64`, estrai lo ZIP e
avvia `Albertelli-Design-Studio-Setup-0.3.1-x64.exe`. Prototipo senza firma editore. La pubblicazione dell'ambiente cloud è un'operazione
diversa dalla compilazione e consegna del programma Windows.
