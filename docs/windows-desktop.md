# Applicazione desktop Windows — confezionamento 0.5.0

## Per chi userà il programma

Destinazione: Windows 10/11 **x64**. ARM64 e Windows precedenti non sono previsti.
Il programma finale si installa per utente, con collegamenti nel menu Start e
sul desktop. L'installer include Electron/Node, interfaccia Next e backend Python
compilato: l'utente finale non dovrà installare Python, Node, Docker o PostgreSQL,
né pagare un hosting. Ogni nuova compilazione va collaudata su Windows.

Le funzioni locali comprendono pianta 2D con importazione DWG/DXF, versioni, moodboard
DEMO e export. Le proposte IA restano il mock dichiarato: non richiedono rete.
Integrazioni IA reali, sincronizzazione e progetti condivisi non sono inclusi.

### Planimetria DWG / DXF (0.5.0)

Usare **Importa planimetria DWG / DXF**, scegliere il file e confermare unità,
anteprima e misure. L’importazione è locale e resta disponibile senza rete.
Il catalogo è chiuso nell’interfaccia; i dati precedenti vengono conservati.
[Istruzioni e limiti](cad-import.md). Il riconoscimento IA è il passaggio successivo.

### Accesso e uscita

Nella versione Windows l'accesso locale è automatico e non richiede una password.
Le credenziali DEMO indicate per la versione web non sono la password del desktop.
Dalla versione 0.3.1, dopo **Esci** compare **Rientra nello studio**, che riapre
la sessione locale senza credenziali. I progetti salvati restano disponibili.
Nella 0.3.0, per superare la schermata di login errata basta chiudere completamente
il programma e riaprirlo dal menu Start.

### Dati e backup

I dati sono separati dai file del programma, normalmente in:

`%APPDATA%\Albertelli Design Studio\data`

Usare **Studio → Apri cartella dati** per conoscere il percorso effettivo.
SQLite `studio.db`, cartella `assets` e `desktop-key` devono restare insieme.
Log separati, consultabili con **Studio → Apri cartella log**.
Non c'è cifratura del database: la riservatezza dipende dall'account Windows e
dalle protezioni del disco. La chiave è locale e non va condivisa.

**Studio → Crea backup dei dati…**:

1. Salva il progetto aperto.
2. Conferma il riavvio dello studio e scegli una cartella privata esterna ai dati.
3. L'app ferma i componenti, copia database/campioni/chiave e scrive un manifest
   con hash SHA-256. Solo alla fine il backup viene dichiarato completo.
4. Lo studio riparte; le modifiche non salvate non fanno parte del backup.

Il backup è una cartella, non uno ZIP. Per recuperarlo, chiudere completamente
il programma, conservare una copia dei dati attuali e ripristinare il contenuto
nella cartella dati. Non copiare sopra un database in uso. Il test automatizzato
apre realmente una copia di backup e ne legge progetto e campione.
Gli aggiornamenti e la disinstallazione sono configurati per conservare i dati;
fare comunque un backup prima di modificare l'installazione.

## Componenti

- `desktop/main.cjs`: finestra Electron, menu, ciclo di vita, download e backup.
- `desktop/runtime.cjs`: supervisione dei due servizi locali e pulizia processi.
- `desktop/api_entry.py`: ingresso Python congelato con PyInstaller.
- `desktop/web-runner.cjs`: Next standalone con il runtime Node incluso in Electron.
- `desktop/backup.cjs`: copia offline e manifest; rifiuta destinazioni ricorsive.
- `desktop/scripts`: build/staging/smoke test; `desktop/tests`: test del payload.

Entrambi i servizi ascoltano soltanto su 127.0.0.1 con porte dinamiche. Il backend
richiede una chiave di processo; il proxy richiede un'altra chiave, iniettata
nelle sole richieste della finestra Electron. L'accesso automatico locale è
abilitato solo in modalità desktop. La versione web conserva il login precedente.
Un secondo processo applicativo non apre lo stesso database: porta in primo
piano la finestra esistente.

Il renderer ha Node disabilitato, contextIsolation e sandbox attivi; nessun preload
privilegiato, nessun permesso hardware, navigazioni esterne e nuove finestre
rifiutate. CSP limita le risorse all'origine locale e ai dati generati per export.
Il programma non apre porte sulla rete LAN. Questo non protegge da malware già
in esecuzione nello stesso account Windows.

## Compilazione nativa Windows

Prerequisiti per **compilare**, non per usare l'app: Git con checkout completo,
Node 24, Python 3.12 x64 e PowerShell. Dalla root del repository:

```powershell
.\desktop\scripts\build-windows.ps1
```

Lo script installa le dipendenze bloccate, genera Next standalone, compila
l'eseguibile Python nativo, copia il payload senza junction assoluti, esegue i
test runtime e crea un installer NSIS x64 in `desktop/release`.
L'app non può essere convertita semplicemente rinominando un eseguibile Linux:
il componente Python deve essere costruito su Windows.

Il workflow **Windows desktop installer** su GitHub Actions parte automaticamente
al push su main dei file applicativi; resta disponibile anche l’avvio manuale. È
predisposto per build nativa, test runtime/browser, finestra Electron, installazione
silenziosa di prova e salvataggio del programma installato. Solo se tutti i
passaggi riescono carica l'artifact `Albertelli-Design-Studio-Windows-x64`, con
installer e checksum SHA-256. Il workflow non pubblica una release automaticamente.

**Installer Windows generato e collaudato su GitHub Actions il 22 ottobre 2026.**
La build nativa, i test runtime/browser, la finestra Electron e l'installazione
con avvio del programma installato sono riusciti.

[Stato build e download Windows](https://github.com/dimadjdima87/Programmi-arredo/actions/workflows/windows-desktop.yml).
La compilazione 0.5.0 viene avviata pubblicando questa modifica. Usare solo
una build completata con successo. Scaricare l’artifact
`Albertelli-Design-Studio-Windows-x64`, estrarre lo ZIP e avviare
`Albertelli-Design-Studio-Setup-0.5.0-x64.exe`. L’artifact contiene SHA256.txt.

## Firma e distribuzione

La configurazione attuale non contiene un certificato di firma dell'editore.
Una build non firmata può mostrare avvisi di autore sconosciuto/SmartScreen.
Per la distribuzione ai collaboratori occorre definire il canale di consegna e
la firma dell'installer. Non disabilitare antivirus o protezioni di Windows.
Nessun aggiornamento automatico o pubblicazione online viene eseguito dal codice.

## Verifica nell'ambiente Linux

```bash
.venv/bin/pip install -r desktop/requirements-build.txt
npm --prefix desktop ci
STUDIO_DESKTOP_BUILD=1 npm --prefix frontend run build
.venv/bin/python desktop/scripts/build-api.py
npm --prefix desktop run stage
CHROMIUM_PATH=/usr/bin/chromium STUDIO_REQUIRE_PAYLOAD=1 STUDIO_TEST_ELECTRON_NODE=1 DESKTOP_BROWSER_TEST=1 npm --prefix desktop test
```

Su reti con proxy, il downloader Electron 45 usa fetch: conservare il proxy/CA
dell'ambiente e, se serve, usare `NODE_USE_ENV_PROXY=1` e una cache scrivibile per
`node desktop/node_modules/electron/install.js`. Gli hash ufficiali restano verificati.
Il pacchetto Electron è 45.0.0, electron-builder 26.15.3, PyInstaller 6.16.0;
lockfile npm inclusi. La build Linux è solo una verifica dei componenti locali.

### Esito del confezionamento verificato qui

È stata provata anche una build **Linux confezionata con ASAR**, oltre al payload
in sviluppo, per controllare percorsi delle risorse e dipendenze incluse. Avvio,
finestra Electron e salvataggio sono riusciti. Il confezionamento usa il padre
`staged` come origine per non escludere i node_modules di Next dalle extraResources.
I flag headless e `--no-sandbox` sono usati soltanto per la prova Linux in un
contenitore ristretto, non nel programma Windows o nella configurazione renderer.
Questo test non sostituisce build e installazione su Windows.
