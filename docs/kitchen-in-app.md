# Albertelli Kitchen nel programma — archivio 0.4.0

Dal 22 ottobre 2026 le sezioni catalogo sono chiuse nell’interfaccia, su
richiesta dello studio. Questa guida descrive la versione precedente.
I dati locali e le API restano conservati. Vedere [planimetrie](cad-import.md).

## Utilizzo su Windows

1. Crea un backup con **Studio → Crea backup dei dati…**, chiudi il programma e
   installa la nuova versione nella stessa cartella. Non occorre disinstallare.
2. [Scarica il pacchetto catalogo ZIP](https://github.com/dimadjdima87/Programmi-arredo/raw/refs/heads/main/downloads/Albertelli-Kitchen-Catalogo-2026.zip).
   Apri **Albertelli Kitchen** nella barra laterale, premi **Carica catalogo
   2026** e scegli `Albertelli-Kitchen-Catalogo-2026.zip` senza estrarlo.
3. Controlla il riepilogo e premi **Conferma caricamento**. Il pacchetto contiene
   8.870 righe e varianti e 901 pagine cucina; non è il PDF originale.

Il caricamento si fa una volta per lo studio locale. In seguito il catalogo è
disponibile senza rete, viene conservato negli aggiornamenti e incluso nei backup.
Il pacchetto è separato dall'installer. Su autorizzazione esplicita dello studio
del 22 ottobre 2026 è scaricabile pubblicamente dalla cartella `downloads/`
del repository; il PDF originale non è incluso.

## Organizzazione

- Basi; colonne e semicolonne; pensili; piani e rivestimenti.
- Ante e finiture; fianchi e complementi; maniglie e accessori.
- Cucine senza maniglie; frontali e ricambi; regole e progettazione.

Le categorie con sole pagine di riferimento aprono il manuale. Le altre mostrano
articoli ricercabili per codice, sigla o descrizione, con filtri per sezione e
livello di verifica. Il codice esatto precede le corrispondenze parziali.
Il dettaglio distingue gruppi prezzi, gruppi colori, superfici, varianti DG,
numero maniglia e codice supplemento. Punti, zeri, indisponibilità e percentuali
mantengono significati distinti. La pagina completa si espande dal dettaglio.

**Preferiti** raccoglie gli articoli ricorrenti. Per preparare un elenco per una
cucina, salva/apri il progetto, entra nella biblioteca e usa **Aggiungi agli
articoli del progetto**. Nella scheda dedicata puoi salvare quantità e note,
rimuovere una voce ed esportare l'elenco con i riferimenti originali.

Le scelte conservano una copia dei dati del catalogo usati. Ricaricare il catalogo
non cambia gli elenchi già salvati. Aprire una scelta mostra la copia conservata
e le pagine della sua edizione, anche se il catalogo corrente è diverso.
Questi elenchi sono separati dalla geometria
e dal ripristino delle versioni della pianta. La selezione di un codice non
inventa un ingombro e non inserisce automaticamente un mobile nella scena.
Il calcolo del costo resta al passaggio successivo.

## Persistenza e importazione

Modulo `backend/kitchen.py`, migrazione additiva versione 3:
`kitchen_libraries` e `kitchen_picks`. Nessuna modifica a scene, progetti o
cataloghi precedenti. Lo SQLite della biblioteca è in
`ASSET_DIR/kitchen/<hash proprietario>/<hash dataset>.sqlite`; sul desktop ASSET_DIR
è sotto la cartella dati già coperta dal backup.

Il file importato non viene eseguito né estratto sul filesystem: si legge soltanto
`catalogo.json` entro limiti espliciti. HTML e SQLite contenuti nello ZIP vengono
ignorati. I byte JSON devono corrispondere all'impronta del dataset già verificato;
il server ricostruisce da zero l'indice locale e attiva il riferimento solo dopo
il completamento. Una futura edizione richiede una nuova verifica e impronta. Le connessioni SQLite
sono chiuse esplicitamente prima di spostare o sostituire un indice, anche su Windows.
Un indice mancante può essere ricostruito ricaricando lo stesso pacchetto.

Limiti: upload 20 MB, JSON 50 MB, archivio espanso 180 MB; niente percorsi,
duplicati o archivio cifrato. L'API controlla sessione, proprietario e progetto;
non espone testo originale riservato o percorsi locali. Le ricerche SQLite FTS5
sono parametrizzate e i token utente non diventano operatori SQL/FTS.
Note e quantità hanno una revisione: un aggiornamento concorrente restituisce
409 anziché sovrascrivere. Nessun caricamento abilita approvazione commerciale,
calcolo prezzi o posizionamento automatico.

## API

- `GET /api/kitchen/status`: disponibilità, edizione, categorie e sezioni.
- `POST /api/kitchen/import?commit=false`: ZIP binario, sola anteprima.
- `POST /api/kitchen/import?commit=true&expected=<dataset corrente>`: indicizzazione.
- `GET /api/kitchen/items`: `q`, `categoryId`, `section`, `state`, `offset`, `limit`.
- `GET /api/kitchen/items/{id}`: voce completa con provenienza.
- `GET /api/kitchen/pages` e `/pages/{numero}`: ricerca e testo delle pagine cucina.
- `GET/POST /api/kitchen/picks`: preferiti (`projectId` vuoto) o progetto proprio.
- `PUT/DELETE /api/kitchen/picks/{id}`: quantità/note o rimozione con revisione.
- `GET /api/kitchen/picks/{id}/reference`: scelta e pagina dell'edizione conservata,
  con accesso limitato al proprietario; `pageNumber` apre altri rimandi della stessa fonte.

Il proxy Next conserva query string, autenticazione, token desktop e controllo
origine; il limite maggiore si applica solo all'importazione cucina. Il pacchetto
privato non è necessario per compilare l'applicazione o eseguire i test pubblici.

## Verifiche

API: 30 test SQLite passati, inclusi isolamento, pacchetto alterato, anteprima,
conflitti, conservazione snapshot e ricostruzione dell'indice. Browser web: 4 test
passati con fixture neutre per la nuova interfaccia. Runtime nativo: 4 test senza
skip, con il vero pacchetto privato fornito localmente, importazione via proxy e
browser, ricerca del codice 21008, preferiti, elenco progetto, quantità/note,
riavvio e ripristino effettivo del backup con indice consultabile. Finestra Electron
collaudata su Linux con profilo/cache scrivibili e flag headless solo di test.

Per ripetere il collaudo privato dopo build/stage:

```sh
STUDIO_REQUIRE_PAYLOAD=1 STUDIO_TEST_ELECTRON_NODE=1 DESKTOP_BROWSER_TEST=1 \
CHROMIUM_PATH=/usr/bin/chromium STUDIO_KITCHEN_PACKAGE=/percorso/privato/catalogo.zip \
npm --prefix desktop test
```

Il collaudo Windows è gestito dal workflow e registrato separatamente una volta
conclusi compilazione, installazione e avvio del programma installato.
