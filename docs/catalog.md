# Fase 2 — Catalogo, provenienza e moodboard

## Funzionalità implementate

- Produttori, prodotti e finiture privati per utente, creazione/modifica,
  approvazione esplicita e archiviazione senza cancellare la cronologia.
- Codici univoci per tipo/produttore/proprietario; revisioni ottimistiche.
- Ricerca e filtri per tipo, produttore e stato.
- Provenienza e diritti d'uso obbligatori per approvare. La classificazione DEMO
  resta immutabile: approvare un campione non lo trasforma in un prodotto reale.
- CSV UTF-8: anteprima con errori numerati, conferma separata, importazione
  atomica in bozza, massimo 500 righe/500 KB, niente sovrascritture implicite.
- Campioni PNG/JPEG privati: massimo 2 MB e 4 milioni di pixel, riduzione a
  1024 px, conversione PNG senza metadati. File su volume separato, hash in DB.
- Inserimento prodotti approvati in pianta con dimensioni e provenienza salvate
  nella scena. Finiture applicabili solo con produttore e codici compatibili.
- Due proposte moodboard deterministiche con riferimenti ai prodotti approvati;
  palette/note modificabili, approvazione manuale, PNG e JSON con riferimenti.

L'approvazione registra una dichiarazione dell'operatore. Il sistema non verifica
indipendentemente contratti, disponibilità, prezzi o documenti dei produttori.
Non sono precaricati marchi reali o SKU commerciali.

## Utilizzo

1. **Catalogo e materiali** → crea un produttore DEMO con codice, fonte e diritti.
2. **Salva bozza**, poi **Approva voce**.
3. Crea un prodotto dello stesso produttore o scarica il modello CSV.
4. Per CSV, copia l'ID del produttore dal modello generato. Verifica il file,
   correggi tutti gli errori, quindi **Importa bozze** e approva ogni voce.
5. Crea/apri una cucina; dal catalogo premi **Inserisci in pianta**.
6. Crea una finitura con lo stesso produttore, colore e codici prodotti compatibili
   separati da `|`. Salva, carica eventualmente il campione e approva.
7. Seleziona l'arredo in pianta, torna al catalogo e **Applica finitura**.
8. In Moodboard, **Proponi dal catalogo · DEMO** sostituisce le proposte correnti
   previa conferma. È possibile annullare. Verifica e approva manualmente.

## CSV

Intestazioni esatte, nell'ordine:

```csv
kind,name,code,manufacturerId,family,width,depth,height,color,isDemo,sourceReference,license,compatibleCodes
```

`kind`: product o finish; produttori creati dall'interfaccia.
`isDemo`: true o false; deve corrispondere al produttore.
Dimensioni numeriche in mm; colore #RRGGBB. Per campi contenenti virgole usare
le virgolette CSV. Non importare le colonne id, revision o status: gli ID vengono
generati e lo stato iniziale è sempre draft. Importare prima i prodotti e poi
le finiture che li referenziano. Il modello propone una riga dimostrativa.

## Contratti API aggiunti

- GET /api/catalog: elenco del solo proprietario.
- POST /api/catalog: `{expectedRevision:0, entry:{...}}`.
- PUT /api/catalog/{id}: stessa struttura, revisione corrente obbligatoria.
- GET /api/catalog/{id}/versions: storico completo.
- POST /api/catalog/import: `{csv:string, commit:boolean}` → righe valide,
  errori con numero di riga, numero e voci importate. Se ci sono errori, zero write.
- PUT /api/catalog/{id}/swatch: corpo binario PNG/JPEG, solo finiture in bozza.
- GET /api/catalog/{id}/swatch: PNG privato autenticato.
- POST /api/catalog/suggestions: due proposte rules-demo, externalAI=false.

Il tipo, codice, produttore e flag DEMO sono immutabili. Riaprire una voce
approvata come bozza prima di modificarla. L'archiviazione è logica e reversibile.

## Compatibilità e conservazione

Migrazione additiva versione 2: catalog_entries, catalog_versions, catalog_assets.
Nessuna modifica alle tabelle o scene della fase 1; i nuovi campi sono opzionali.
Gli snapshot catalogProduct/catalogFinish/catalogReferences conservano la revisione
usata. Aggiornare o archiviare il catalogo non aggiorna scene già salvate.
Il server respinge nuovi riferimenti alterati, non approvati, di altri utenti o
non correnti; conserva i riferimenti storici invariati già presenti nella scena.
Le dimensioni di prodotti reali referenziati non possono essere alterate.

I campioni sono file nel volume studio-assets (ASSET_DIR in locale), non blob SQL.
L'immagine del catalogo mostra l'ultimo campione caricato; gli export di moodboard
usano palette e riferimenti testuali. Non c'è rendering storico delle texture,
né caricamento di modelli 3D. File sostituiti restano conservati: una politica di
retention e uno storage S3 richiedono un successivo lavoro prima della produzione.

## Passaggi ancora da completare nella Fase 2

- Provider IA reale: nessun binding credenziale configurato nell'ambiente.
  Il flusso usa il mock deterministico dichiarato; non effettua chiamate esterne.
  Per attivare un provider serviranno scelta del servizio, consenso, budget e
  credenziali server configurate in modo sicuro, mai in chat o nel client.
- Ruoli amministratore/catalog manager, catalogo condiviso tra operatori e
  verifica commerciale dei dati non sono inclusi nell'autenticazione demo.

Il catalogo e le moodboard locali funzionano senza questi servizi esterni.
