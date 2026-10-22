# Catalogo di riferimento Albertelli Kitchen 2026

## Scopo e confini

Il manuale fornito dallo studio è la fonte primaria: non viene modificato e non
viene caricato nel repository o incorporato nell'installer. La biblioteca
generata permette di cercare codici, sigle, punti e note senza servizi esterni.
Non è ancora un insieme di prodotti approvati inseribili nella pianta: il modello
del catalogo attuale non rappresenta matrici di prezzo, regole, unità e ingombri
configurati. Non importare queste informazioni nel vecchio CSV perdendo campi.

Le aree Living, Bagno e guardaroba del manuale (pagine PDF 841–1024), oltre alla
pagina di opzioni specifica bagno 187, restano fuori dalla consultazione cucina.
L'inventario privato conserva comunque tutte le 1.086 pagine. L'illuminazione
integrata nelle opzioni cucina rimane una nota della cucina; non viene creato
un catalogo autonomo Illuminazione.

## Riproduzione

Sono necessari Python, Poppler (`pdftotext`) e le dipendenze di estrazione:

```sh
.venv/bin/python -m pip install -r scripts/requirements-kitchen-catalog.txt
.venv/bin/python scripts/kitchen_catalog.py /percorso/manuale.pdf /percorso/privato/catalogo-nuovo
.venv/bin/python scripts/audit_kitchen_catalog.py /percorso/manuale.pdf /percorso/privato/catalogo-nuovo
.venv/bin/pytest scripts/tests/test_kitchen_catalog.py -q
CHROMIUM_PATH=/usr/bin/chromium node scripts/tests/kitchen_catalog.browser.cjs /percorso/privato/catalogo-nuovo/catalogo.html
```

Il file è riconosciuto tramite SHA-256 e numero di pagine. Un'edizione o un PDF
diverso richiede verifica e aggiornamento delle mappature prima dell'importazione.
La destinazione deve essere nuova: i cataloghi esistenti non vengono sovrascritti.
Queste dipendenze servono per preparare i dati, non per consultare il risultato.

## Pacchetto di consultazione

`Albertelli-Kitchen-Catalogo-2026.zip` contiene:

- `catalogo.html`: consultazione autonoma, ricerca articoli/pagine, filtri e note;
  apribile dopo l'estrazione dello ZIP, senza hosting o installazione.
- `catalogo.json`: inventario, occorrenze, celle e testo delle fonti.
- `catalogo.sqlite`: stessa evidenza indicizzata, ricerca testuale FTS5 e codici
  conservati come stringhe, comprese le cifre iniziali zero.
- `rapporto.json`: conteggi e stati della preparazione.
- `verifica.json`: audit della fonte, integrità, campione visivo e pagine residue.
- `SHA256SUMS.txt` e `LEGGIMI.txt`.

JSON/SQLite conservano la fonte testuale originale privata. Nell'HTML le
denominazioni vengono adattate al nome dello studio e i recapiti del fornitore
vengono omessi, senza inventare recapiti Albertelli. L'originale resta l'autorità
per attribuzioni, condizioni e disegni; il testo di consultazione è una derivazione.
Il pacchetto contiene dati interni: non pubblicarlo nel repository né in un
artifact pubblico senza un'istruzione specifica dello studio.

## Controlli e significato degli stati

L'estrattore legge la griglia e i caratteri del PDF con PyMuPDF e confronta i
valori con Poppler, un secondo lettore. Vengono considerate coordinate, riquadro
di ritaglio, numero e ordine delle colonne; le celle separate da tabulazioni
richiedono un conteggio esatto dei token. I richiami in apice non sono cifre dei
punti. I trattini sono indisponibilità, mai zeri; celle vuote sono sconosciute.

Si conservano separatamente gruppi prezzi, gruppi colori, superfici e varianti
DG. Per le maniglie il numero della maniglia è distinto dal codice supplemento.
Lo stesso codice può ricorrere in pagine e configurazioni diverse: ogni
occorrenza ha un ID distinto, pagina, sezione e contesto. Non si effettuano fusioni
o aggiornamenti impliciti dei progetti esistenti.

- `cross_checked`: codice e celle concordano tra lettori; non è approvazione
  commerciale o prova che la configurazione sia consentita.
- `needs_review`: valori o condizioni non rappresentabili con sicurezza come
  punti, da consultare nella fonte. Una percentuale non deve diventare punti.
- `not_listed`: per la scheda maniglia non è presente un valore punti esplicito
  estratto; non equivale a prezzo zero o gratuità.
- `commercialStatus=needs_review`, `usableForPricing=false`: valgono per tutte
  le occorrenze, fino alla modellazione e alla verifica delle regole applicabili.

Il campione visivo dell'audit riguarda 29 righe e 142 celle confrontate con le
pagine originali 188, 189, 200 e 295. Quattro zeri delle pagine 188 e 189 sono
grafici, assenti dai due strati testuali: hanno stato `visual_checked` e non sono
dichiarati concordi tra i lettori. Le regole percentuali hanno stato `rule_checked`,
con riferimenti alla base di applicazione e senza conversione in punti.
Non estendere questa verifica visiva a tutto il manuale.
La ricerca nelle pagine copre anche i contenuti non strutturati; disegni e simboli
grafici restano nel PDF originale. Le misure non vengono trasformate in ingombri
di mobili senza distinguere scocca, frontale, zoccolo e piano.

Il browser di prova dell'ambiente blocca `file://`: il test serve lo stesso HTML
inalterato su loopback e controlla che non generi richieste a servizi esterni.
Questo non aggiunge un server al pacchetto distribuito.

## Passaggio successivo

Modellare unità, maggiorazioni, condizioni, misure e finiture con provenienza;
approvare sezioni progressive e integrare la consultazione nell'applicazione
Windows. Solo dopo questi controlli introdurre il calcolo richiesto dallo studio
(punti / 1,46 e regole specifiche per lunghezze e lavorazioni).
