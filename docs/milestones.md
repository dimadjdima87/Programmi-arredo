# Milestone

## Priorità attuale — cucine Albertelli Kitchen

Completare prima le cucine per l'uso interno dello studio. I cataloghi Living,
Zona notte, Bagno e Illuminazione saranno forniti in seguito.
Piano, fonti e campione verificato: [Catalogo cucine 2026](kitchen-catalog-2026.md).

- [x] Acquisizione manuale 2026 e guida qualità, estrazione testuale e primi
  confronti visivi di codici, punti e regole dei piani.
- [x] Catalogo di riferimento offline con ricerca, SQLite/JSON, provenienza,
  doppio controllo numerico, regole percentuali e verifiche visive registrate.
  Risultati e limiti: [importazione verificata](kitchen-catalog-import.md).
- [ ] Importazione strutturata e verifica delle sezioni cucina.
- [ ] Modello dati per varianti, gruppi, punti, unità e note tecniche.
- [ ] Composizione e collaudo di una cucina con articoli reali verificati.
- [ ] Calcolo dei costi (successivo): punti / 1,46, quantità e supplementi.
- [ ] Aggiornamento Windows collaudato.

La sequenza storica delle fasi sotto non supera questa priorità concordata.

## Fase 0
- [x] Struttura frontend/backend, Compose PostgreSQL, seed demo, CI e README.
- [x] Installazione, avvio e test eseguiti, con risultati documentati.

## Fase 1
- [x] Login demo e isolamento tra due utenti.
- [x] Cucina 4200 × 3600 mm; poligono con muri identificati stabilmente.
- [x] Porta/finestra con offset e dimensioni validati.
- [x] Aggiunta, movimento, rotazione, rimozione mobili DEMO e lock.
- [x] Salva/ricarica senza deriva, undo/redo e ripristino versioni.
- [x] Due moodboard DEMO con palette e note modificabili, approvazione.
- [x] Esportazione PNG pianta/moodboard e JSON dello stato selezionato.
- [x] Test geometria, finiture, persistenza, conflitti e autorizzazioni; E2E browser.

## Successiva: Fase 2
Cataloghi autorizzati e provenienza, import CSV validato, materiali e approvazione.
IA strutturata soltanto dopo aver definito provider, consenso e budget.

## Fase 2 — Catalogo e materiali
- [x] CRUD privato produttori/prodotti/finiture, ricerca e filtri.
- [x] Approvazione, provenienza, licenze e cronologia catalogo.
- [x] CSV con anteprima, errori di riga e importazione atomica in bozza.
- [x] Campioni caricati con limiti, controllo formato e accesso autenticato.
- [x] Inserimento in pianta e finiture compatibili senza deriva geometrica.
- [x] Moodboard rules-demo con soli riferimenti approvati, editing ed export.
- [ ] Provider IA reale con output strutturato e credenziali server (non configurato).

Dopo l'integrazione e la verifica del provider, Fase 3: anteprima 3D geometrica
con proxy esplicitamente distinguibili dai modelli accurati di produttore.


## Desktop Windows — 0.3.0
- [x] Finestra Electron con runtime locale e database nel profilo utente.
- [x] Backend compilabile nativamente e frontend standalone relocabile.
- [x] Protezione delle porte locali e accesso automatico solo desktop.
- [x] Backup dei dati salvati e test di apertura della copia recuperata.
- [x] Script Windows e workflow di build/test/installazione NSIS predisposti.
- [x] Build e collaudo effettivi dell'installer su Windows x64 (GitHub Actions, 22 ottobre 2026).
- [x] Installer disponibile come artifact GitHub scaricabile.
- [ ] Firma editore per la distribuzione.
