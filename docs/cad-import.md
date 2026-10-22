# Planimetrie DWG / DXF — 0.5.0

## Uso

Premere **Importa planimetria DWG / DXF** nella barra laterale, oppure
**Importa DWG / DXF** nella pianta di un progetto aperto.
Scegliere un file fino a 30 MB, verificare le unità (mm, cm, m, pollici o piedi),
l’anteprima e le dimensioni. Nei livelli si possono escludere quote, arredi
ed elementi estranei. Spuntare la conferma e premere **Usa questa planimetria**.
Salvare il progetto. La base viene conservata nelle revisioni e nei backup.
**Inquadra pianta**, zoom, spostamento vista ed esportazione PNG sono disponibili.

L’importazione sostituisce muri, aperture e arredi correnti. Annulla/Ripristina
consentono di recuperare lo stato precedente prima del salvataggio.
Non viene inventato un perimetro rettangolare intorno alla pianta.
La geometria CAD è una base 2D: non rappresenta ancora muri, stanze o aperture
riconosciuti. Il riconoscimento IA e la progettazione assistita sono successivi.

## Lettura e limiti

DWG: LibreDWG Web 0.8.2 in WebAssembly. DXF testuale: dxf-parser 1.1.2.
La lettura avviene in un worker locale separato, terminato al termine o dopo
60 secondi. Non si caricano il file, riferimenti esterni, script o immagini remote.
I lettori e il file WASM sono inclusi nell’applicazione; nessun CDN è necessario.

Si estraggono linee, polilinee (archi bulge campionati), archi, cerchi e blocchi
annidati con traslazione, rotazione e scala. Le curve vengono approssimate ogni
5 gradi. Testi, quote, retini, spline, oggetti speciali, riferimenti esterni,
matrici di blocchi e piani inclinati non sono riprodotti: l’anteprima mostra
un riepilogo degli elementi omessi. La compatibilità non è garantita con ogni
versione DWG; in caso di errore provare DWG 2013 o DXF testuale.

Massimo 5.000 tracciati e 60.000 vertici, con ingombro selezionato fino a
50 × 50 metri. Le coordinate selezionate vengono normalizzate in millimetri,
con origine in alto a sinistra e Y invertita dal sistema CAD. Il progetto
conserva nome, SHA-256 della fonte, fattore di scala, origine CAD, geometria e
avvisi; non conserva i byte originali del DWG. Conservare anche il file originale.

## Catalogo

Entrambe le sezioni catalogo sono chiuse nella navigazione dalla 0.5.0.
Le importazioni, preferiti e schede locali preesistenti non vengono cancellati;
le API e i relativi test restano disponibili per non compromettere i backup.
La pubblicazione del pacchetto catalogo precedentemente autorizzata non è revocata.

## Componenti distribuiti

Il lettore DWG e il worker/adattatore CAD sono GPL-3.0; licenza, provenienza
e sorgenti sono indicati in `frontend/public/cad/NOTICE.txt` e `COPYING`.
Il lettore DXF è MIT (`DXF-LICENSE.txt`). Il fixture DWG pubblico di LibreDWG
è distinto dai file dei clienti e ne indica provenienza e licenza.
