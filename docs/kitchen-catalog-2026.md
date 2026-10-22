# Albertelli Kitchen — catalogo cucine 2026

## Ambito concordato

Priorità: completare le cucine per l'utilizzo interno dello studio. I cataloghi
Living, Zona notte, Bagno e Illuminazione saranno caricati successivamente;
non includerli nell'importazione attuale, anche se presenti nel manuale.
Identità visibile nell'applicazione e nei documenti generati: Albertelli Kitchen.
Il PDF originale resta una fonte privata di controllo, senza essere redistribuito
nel repository o nell'installer.

Il calcolo dei costi è un passaggio successivo all'importazione verificata.
Requisito comunicato dallo studio: punti / 1,46; la conversione del listino lordo
va distinta da eventuali condizioni commerciali nette, IVA e montaggio.

## Stato delle fonti

Il 22 ottobre 2026 sono stati scaricati il manuale completo (1.086 pagine) e la
guida qualità (92 pagine). Il testo del manuale è stato estratto integralmente.
Questo non costituisce un'importazione strutturata o una validazione completa.
Confrontate visivamente le pagine PDF 200 e 295 con il testo estratto.

La biblioteca è ora integrata nel programma dalla versione 0.4.0: il pacchetto
privato carica 8.870 occorrenze e 901 pagine cucina ricercabili, con matrici e note
conservate. Include preferiti ed elenchi degli articoli per progetto.
Vedere [utilizzo nel programma](kitchen-in-app.md) e
[preparazione e controlli](kitchen-catalog-import.md).
Non ridurre questi dati al solo CSV prodotti precedente, che non ne rappresenta
unità e regole. Il posizionamento in pianta richiede ancora ingombri configurati.

## Campione verificato

| Famiglia | Sigla | Codice | Dimensioni / condizioni | Punti |
| --- | --- | --- | --- | --- |
| Base porta-baguette | UABTD | 21008 | Larghezza 300 mm, corpo 720 mm, profondità laterale 561 mm; gruppo prezzi 1 | 1006 |
| Piano con bordo D | APD60 | 7460 | Spessore 38 mm, profondità fino a 600 mm; gruppo colori 1; per 100 mm iniziati | 27,6 |
| Piano con bordo D | APD60 | 7460 | Stesse dimensioni; gruppo colori 2; per 100 mm iniziati | 47,7 |

Fonti: pagina PDF 200 / riferimento M 3.6 e pagina PDF 295 / M 4.1.
Le dimensioni laterali e del corpo non vanno confuse con l'ingombro finale:
per l'inserimento in pianta serviranno anche frontali, zoccolo e piano scelti.

## Sequenza di lavoro

1. **Importazione verificata**: separare le sezioni cucina, mantenendo codice
   come testo, sigla, descrizione, dimensioni, gruppo prezzi/colore, punti,
   unità, note, rimandi, pagina PDF e riferimento stampato. Valori dubbi restano
   da verificare. Un trattino di indisponibilità non è uno zero.
2. **Catalogo utilizzabile**: estendere il modello dati con revisioni e provenienza;
   selezionare articoli e varianti validi, senza inventare finiture o dimensioni.
   Conservare gli snapshot dei progetti già salvati.
3. **Composizione cucina**: verificare basi, colonne, pensili, angolari, pannelli,
   zoccoli, piani e accessori necessari; controllare posizionamento, ingombri,
   salvataggio, riapertura ed esportazione su un progetto concreto.
4. **Costi**: introdurre la conversione dei punti dopo la verifica del catalogo,
   con quantità e supplementi espliciti e un riepilogo controllabile.
5. **Distribuzione Windows**: creare un aggiornamento dopo i controlli, indicando
   chiaramente quali sezioni sono state validate.

## Regole da preservare per il futuro calcolo

- I mobili possono avere dieci gruppi prezzi, con disponibilità e note diverse.
- I gruppi colori dei piani sono distinti dai gruppi prezzi dei mobili.
- Per i piani lineari esaminati il listino usa **100 mm iniziati**: 2350 mm
  corrispondono a 24 unità. Non arrotondare semplicemente al metro intero.
- Esistono anche elementi angolari a pezzo, lavorazioni, bordature e giunzioni
  con regole separate; non estendere automaticamente la tariffa lineare.
- Supplementi e note possono limitare modelli, maniglie, finiture e dimensioni.
- Nessun valore ambiguo deve generare automaticamente un costo.

Il completamento dell'estrazione richiede confronti ulteriori sulle sezioni:
non è ancora attestata una precisione del 100% sull'intero manuale.
