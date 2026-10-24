# Riconoscimento locale della planimetria — 0.6.0

## Uso nello studio

1. Importare DWG/DXF e controllare unità e misure, come nella versione 0.5.0.
2. Premere **Riconosci muri e ambienti → Avvia riconoscimento locale**.
3. Confrontare i colori con il CAD: muri blu, porte verdi, finestre azzurre,
   ambienti arancioni. Le aperture senza classificazione restano evidenziate.
4. Selezionare gli elementi sul disegno o nell’elenco. Correggere coordinate,
   spessori, muro di appartenenza, larghezze, nomi e destinazioni degli ambienti.
   Si possono aggiungere o rimuovere elementi e vertici dei contorni.
5. Dopo modifiche ai muri, usare **Ricalcola ambienti dai muri**. Questo
   sostituisce contorni e nomi; la conferma avvisa e **Annulla correzione** recupera
   lo stato precedente. Gli ambienti non si ricalcolano in silenzio.
6. Spuntare il controllo e premere **Conferma nel progetto**, poi **Salva progetto**.
   I risultati vengono conservati nelle revisioni e nei backup. **Rivedi muri e
   ambienti** consente ulteriori correzioni. Annulla/Ripristina dello studio
   recuperano l’intera modifica. Una nuova importazione elimina dal progetto
   aperto il riconoscimento precedente, che resta recuperabile con Annulla.

## Cosa riconosce

È un interprete geometrico locale, basato su regole e topologia CAD. Non è un
modello neurale o generativo. Non richiede chiavi API, abbonamenti, GPU o Internet;
non trasmette disegni. I costi API sono zero. I servizi IA esterni rimangono una
possibile integrazione successiva: il loro listino corrente non è stato verificato.

- Muri: coppie di linee quasi parallele distanti 70–600 mm, livelli dedicati ai
  muri, oppure contorni chiusi candidati. Il livello `MURI_PORTANTI` è distinto
  dai livelli delle porte. Uno spessore non misurabile viene proposto a 200 mm,
  con evidenza e stato da verificare.
- Porte: livelli dedicati o archi di apertura quasi circolari, prossimi a un
  muro candidato. Porte scorrevoli, aperture atipiche e archi non separati
  possono richiedere inserimento manuale.
- Finestre: geometria connessa sui livelli dedicati (`FINESTRE`, `WINDOW`, ecc.),
  prossima al muro. Senza questi livelli non viene assegnata arbitrariamente
  la classificazione finestra: può essere necessaria la correzione manuale.
- Interruzioni di 250–1500 mm fra muri allineati possono diventare aperture
  **da classificare**. Il muro ospitante è continuo; l’apertura rappresenta il vuoto.
- Ambienti: facce chiuse fra assi dei muri, con sottrazione degli spessori.
  Superficie derivata dal contorno proposto, non rilievo certificato. Spazi
  inferiori a 0,5 m², contorni con fori/pilastri interni o oltre 100 vertici non
  sono ricostruiti automaticamente. Pareti curve non sono modellate come archi.

Il CAD importato non include testi e quote come oggetti semantici. Non si
inventano quindi funzioni delle stanze: gli ambienti si chiamano inizialmente
**Ambiente 1**, ecc., con destinazione **Da assegnare**. Una pianta con un solo
livello, arredi mescolati ai muri, contorni aperti o imprecisioni può richiedere
molte correzioni. I livelli dei muri sono selezionabili nella revisione.

## Dati e controlli

`scene.recognition` conserva segmenti indipendenti (anche muri interni), aperture
con muro/offset/larghezza e contorni dei singoli ambienti. Il vecchio
`scene.walls` resta il perimetro dei progetti manuali: non viene usato per
simulare un appartamento con più stanze. Il campo è opzionale, quindi i progetti
precedenti restano leggibili. Non occorre migrare o cancellare il database.

La provenienza include `engine=cad-geometry-v1`, motivazioni per elemento,
stato `possible/strong/manual`, avvisi e fingerprint della geometria di riferimento.
Questi stati non sono probabilità statistiche. Il fingerprint comprende fonte,
scala, dimensioni e tracciati. Un risultato riferito a una geometria diversa
viene rifiutato. Solo un riconoscimento confermato può essere salvato nel progetto.
Si controllano limiti, coordinate finite, contorni semplici, muri lunghi almeno
100 mm, aperture entro il muro e non sovrapposte e identificativi unici.

API autenticate:

- `POST /api/plan/recognize`: riferimento CAD e livelli facoltativi dei muri;
- `POST /api/plan/validate`: verifica della bozza prima della conferma;
- `POST /api/plan/rooms`: ricostruzione ambienti dai muri corretti.

La richiesta resta entro 5 MB; il proxy concede 60 secondi. Una sola analisi
locale per processo può essere in corso. Limiti: 6.000 segmenti candidati,
500.000 confronti spaziali, 500 muri, 300 aperture e 100 ambienti. Un disegno
oltre i limiti richiede selezione dei livelli o semplificazione del CAD.

Shapely 2.1.2 / GEOS e NumPy 2.3.4 vengono inclusi nel backend nativo Windows.
Nessun pacchetto va installato sul PC dell’utente.

## Verifica

38 test backend: regressioni, geometrie ruotate, muri doppi, arco porta,
finestra su livello dedicato, superfici e stanze multiple, aperture incerte,
rifiuto di risultati obsoleti e persistenza dopo conferma.
8 test frontend includono un appartamento DXF sintetico: riconoscimento,
correzione, rifiuto di larghezze invalide, denominazione della cucina,
conferma, annulla/ripristina, salvataggio/riapertura e cambio di fonte.
Il test intercetta la rete e fallisce se parte una richiesta esterna.
4 test runtime desktop senza skip verificano motore nativo, persistenza del
riconoscimento, riavvio e ripristino del backup. La finestra Electron legge
un DWG reale e salva anche il riconoscimento locale. I fixture sono pubblici
o creati per i test, non sono planimetrie reali dei clienti dello studio.


La build Windows 0.6.0 del commit `2a7772c` è stata compilata e installata con
esito positivo: [download verificato](https://github.com/dimadjdima87/Programmi-arredo/actions/runs/40086705994#artifacts).
La finestra installata ha eseguito importazione DWG, riconoscimento, conferma e
salvataggio. Le prove sui DWG dello studio restano il passo di verifica successivo.
