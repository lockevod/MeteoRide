# Guida utente di MeteoRide

L'aiuto che trovi dentro l'app risponde a "che cosa devo fare". Questa guida
risponde a "perché" e a "cosa succede se". Qui ci sono tutti i dettagli: i limiti
di ogni fornitore, cosa salva l'app e dove, come si comporta senza segnale e come
ottenere le app o gestire una copia tua.

Versión en español: [GUIA.md](GUIA.md) · English version: [GUIDE.md](GUIDE.md) · Aiuto nell'app:
[help_it.html](https://app.meteoride.cc/help_it.html)

---

## 1. Che cos'è MeteoRide

MeteoRide è un'applicazione per ciclisti —sul web e come app per iPhone e
Android— che carica percorsi GPX/KML e mostra le previsioni meteo lungo il
percorso.

L'app calcola i passi del percorso in base alla velocità che scegli e chiede a uno
o più fornitori meteo temperatura, vento, precipitazioni, umidità, nuvolosità,
luminosità e indice UV in ciascuno di quei passi. Include fonti di riserva
automatiche, così hai dati anche quando un fornitore fallisce, e può confrontare
le previsioni di fonti diverse o di due date diverse.

MeteoRide non modifica il percorso: si limita a leggerlo.

---

## 2. Per iniziare

### 2.1 Carica un percorso GPX/KML

Premi il pulsante **📁** e scegli il tuo file. Sono supportati tracce, percorsi e
waypoint GPX e KML standard.

Puoi anche caricare un percorso da un link con i parametri descritti in
[§9.4](#94-url-con-parametri), oppure condividerlo da un'altra app se usi l'app
nativa ([§6](#6-nellapp-per-iphone-e-android)).

### 2.2 Data e ora

Scegli quando pensi di uscire. Il sistema arrotonda l'ora a intervalli di 15
minuti in automatico.

### 2.3 Velocità

Inserisci la tua velocità media stimata o usa uno dei valori predefiniti: 5, 10,
12, 15 o 20 km/h. L'ora in cui sarai in ogni punto dipende da questa velocità,
quindi è ciò che cambia di più il risultato.

### 2.4 Intervallo

Scegli ogni quanto vuoi le informazioni meteo: ogni 15 o 30 minuti.

### 2.5 Fornitore

Scegli il fornitore o la catena di fornitori che vuoi usare. Sono descritti in
[§4](#4-fornitori-meteo). Cosa succede quando quello che hai scelto fallisce è in
[§9.3](#93-fonti-di-riserva-intelligenti).

### 2.6 Modalità confronta fornitori

Scegli **Confronta** nel menu dei fornitori per valutare le differenze tra i
fornitori sullo stesso percorso e alla stessa ora.

- Legge Open-Meteo e AROME esattamente come la tabella normale, compresi i dati
  ogni quarto d'ora entro le prime 5 ore.
- Se un fornitore non risponde, l'avviso indica quello che ha fallito invece di
  mostrare un errore generico.

### 2.7 Modalità confronta date

Confronta le previsioni per lo stesso percorso in due date o orari diversi.

- Premi **⇄** accanto alla data per entrare in questa modalità.
- Imposta la Data A e la Data B; la seconda data compare sotto la prima.
- Premi **⟲** per aggiornare la tabella.
- La tabella mostra 4 righe: intervalli della Data A, riepilogo della Data A,
  intervalli della Data B, riepilogo della Data B.
- **Non c'è ricalcolo automatico.** Se cambi un controllo qualsiasi devi premere
  di nuovo ⟲.

---

## 3. Caricare percorsi da altri siti (userscript)

Il progetto include due userscript facoltativi per Tampermonkey. Non servono per
usare MeteoRide; sono scorciatoie per chi pianifica su altri siti. Le istruzioni
di installazione sono in [USERSCRIPTS.md](USERSCRIPTS.md).

- **Komoot / Bikemap / Hammerhead → MeteoRide**: aggiunge un pulsante che apre
  direttamente in MeteoRide il percorso che stai guardando. Su Komoot lo
  scaricamento del GPX è disponibile solo con un account **Premium**; senza, lo
  script non può ottenere il file.
- **MeteoRide → Hammerhead**: aggiunge in MeteoRide un pulsante che esporta il GPX
  attuale su Hammerhead (dashboard.hammerhead.io). Lo script carica il GPX così
  com'è su uno share-server che configuri tu e chiede a Hammerhead di importare
  quell'URL.

---

## 4. Fornitori meteo

| Fornitore | Chiave API | Orizzonte | Copertura |
|---|---|---|---|
| Open-Meteo | No | 14 giorni | Globale |
| OpenWeather | Sì (livello gratuito) | 4 giorni | Globale |
| AROME-HD | No | 36 ore | Parte dell'Europa |

- **Open-Meteo**: gratuito, senza chiave, copertura globale, fino a 14 giorni.
  Open-Meteo sceglie il suo modello migliore per la zona della tua traccia.
  Consigliato in qualsiasi situazione, e ideale per pianificare a lungo termine e
  per i percorsi fuori dall'Europa.
- **OpenWeather**: richiede una chiave API, fino a 4 giorni. Ottimi dati in tempo
  reale, ed è **l'unico fornitore che pubblica allerte meteo ufficiali**
  ([§11](#11-allerte-meteo-ufficiali)). Il migliore per partenze immediate e zone
  urbane.
- **AROME-HD**: modello ad alta risoluzione (~1-2 km) di MeteoFrance, raggiunto
  tramite Open-Meteo e senza chiave. Disponibile solo per l'Europa
  (circa 39-52°N, 10,5°O-16,5°E) ed entro 36 ore. Fuori da quella zona o da
  quell'intervallo passa direttamente al miglior modello che Open-Meteo ha per
  quel luogo, senza nulla di strano da segnalare: i dati ci sono comunque.
  Superiore per vento e precipitazioni a breve termine in Francia e nei paesi
  vicini.

### Catene di fornitori

Le catene combinano i punti di forza di più fornitori nella stessa tabella:

- **OpenWeather → AROME-HD → Open-Meteo**: dati in tempo reale di OpenWeather per
  la prima ora, la precisione iperlocale di AROME per le 47 ore successive e
  Open-Meteo per il resto della previsione. Richiede una chiave di OpenWeather;
  senza, l'opzione è disattivata nel selettore.

Scegli in base a ciò che ti serve: precisione in tempo reale (OpenWeather),
precisione locale (AROME-HD) o pianificazione a lungo termine (Open-Meteo).

---

## 5. Usarlo nel browser

L'app web funziona in qualsiasi browser recente, su computer o su telefono, su
<https://app.meteoride.cc>. Non c'è niente da installare.

Per l'app per iPhone o Android, installala dall'App Store o con l'APK da GitHub;
i passi sono in [`docs/INSTALL.md`](INSTALL.md).

---

## 6. Nell'app per iPhone e Android

Queste cose esistono solo dentro l'app nativa: sono cose che un browser non può
fare.

### 6.1 Invia il percorso a un'altra app

Con un percorso caricato, il pulsante **📤** nella barra in alto apre il menu di
condivisione del sistema con il GPX allegato. Da lì va al tuo ciclocomputer
(Hammerhead, Wahoo), a File, alla posta, dove preferisci. Il file non lascia mai
il dispositivo: non c'è nessun server intermedio, a differenza del Comando rapido
di iOS di cui ha bisogno il sito.

### 6.2 Ricevi un percorso da un'altra app

Funziona anche al contrario: in Komoot, Strava, Bikemap, File o nella posta,
condividi il GPX e scegli **MeteoRide**. L'app si apre con il percorso già
caricato. Lo stesso vale per "Apri in MeteoRide" da un file scaricato.

Se la prima volta MeteoRide non compare nel menu di condivisione, riavvia il
telefono: il sistema impiega un po' a registrare l'app come destinazione.

### 6.3 Avvisi quando il meteo sul tuo percorso cambia

Una previsione è una stima fatta con ore di anticipo. Quando calcoli un percorso,
l'app continua a tenerlo d'occhio e ti avvisa se peggiora nelle ore in cui sarai
fuori:

- Era asciutto e arriva la pioggia, oppure la pioggia diventa forte.
- Era calmo e arriva vento moderato o forte, oppure raffiche da circa 43 km/h.
- Viene emessa un'allerta ufficiale che coincide con la tua uscita. Serve una
  chiave di OpenWeather e le allerte ufficiali attivate.

Ogni cambiamento viene segnalato una volta; se peggiora di nuovo, ne vieni
avvisato di nuovo. I miglioramenti non vengono segnalati, e nemmeno i tratti che
hai già percorso. Il controllo finisce un'ora dopo l'ultimo punto del percorso.

Lo attivi e disattivi in **Impostazioni → Allerte → "Avvisami se il meteo sul
percorso cambia"**, attivo per impostazione predefinita, dove una riga sotto
indica quale percorso viene controllato e fino a quando.

**Da sapere:** il controllo lo esegue il sistema operativo quando vuole lui, non
l'app. Su iPhone deve essere attivo l'Aggiornamento app in background per
MeteoRide (Impostazioni → Generali), e la modalità Risparmio energetico lo
sospende. Su Android, alcuni produttori chiudono le attività in background con il
loro gestore della batteria. Quando il sistema non lo eseguirà, l'app lo dice
sotto l'interruttore invece di lasciarti credere di essere sotto controllo.

### 6.4 Senza segnale

Il meteo non si può inventare, ma quello che era già stato scaricato non viene
buttato via:

- Aprendo l'app ritrovi l'ultimo percorso con la sua tabella, senza caricare
  nulla.
- Una previsione vecchia viene comunque mostrata, indicando quante ore ha. Si
  ferma a dodici.
- Lo sfondo della mappa ha bisogno di connessione. Le tessere che hai guardato
  vengono conservate solo per il tempo che il server della mappa consente (i
  termini di OpenStreetMap vietano l'uso offline), quindi senza segnale lo sfondo
  può restare vuoto; la mappa lo dice, e il percorso e la tabella si vedono
  comunque.
- Quando non c'è nessun dato, lo dice invece di lasciare uno schermo vuoto senza
  spiegazioni.

Il pulsante **📴** salva le previsioni del percorso caricato e le protegge dalla
pulizia automatica della cache. Premilo a casa prima di partire.

### 6.5 Mappa e impostazioni

- Senza percorso caricato, la mappa si apre dove ti trovi invece che a Barcellona.
- L'app parte nella lingua del telefono finché non ne scegli una a mano.
- Unità, lingua, la tua chiave API, i percorsi recenti e le tessere che hai già
  guardato sono salvati fuori dal browser interno, in una forma che WebKit
  conserva davvero: resistono quando il sistema recupera spazio e su iPhone sono
  ancora lì quando riapri l'app. Prima non era così.
- La prima volta che la mappa ti cerca, il sistema chiede il permesso di
  localizzazione a nome di MeteoRide.
- Il telefono resta in verticale, perché ruotandolo l'impaginazione si rompe.
  L'iPad invece ruota.

---

## 7. Impostazioni

### 7.1 Chiavi API

Solo OpenWeather richiede una chiave, e solo se vuoi quel fornitore o le allerte
ufficiali. Si ottiene gratis da
[openweathermap.org/api](https://openweathermap.org/api) (One Call API).

Accanto al campo c'è un pulsante **🔍 Verifica**: l'app fa una richiesta semplice
e ne mostra lo stato lì accanto (valida / non valida / quota / codice HTTP). Usalo
prima di uscire di casa se hai appena creato la chiave; OpenWeather impiega un po'
ad attivarle.

### 7.2 Avvisi non critici

La casella **Mostra gli avvisi non critici** regola quanto sono dettagliate le
notifiche. Se è attivata, vedrai banner informativi quando si passa a una fonte di
riserva per limiti di orizzonte, quota o errori dell'API. Se è disattivata, vengono
mostrati solo gli errori critici.

### 7.3 Unità

- **Vento:** km/h, m/s, mph
- **Temperatura:** °C, °F
- **Distanza:** km, mi
- **Pioggia:** mm, in

### 7.4 Lingue

L'applicazione è disponibile in spagnolo, inglese, catalano, galiziano, basco,
francese, tedesco, italiano e portoghese. La lingua scelta cambia l'interfaccia e
i messaggi. Nell'app nativa, finché non ne scegli una a mano, si usa la lingua del
telefono.

### 7.5 Pulsante di debug

**Impostazioni → Mostra il pulsante di debug** attiva il pulsante 🐞. All'inizio è
disattivato. Serve per allegare informazioni quando segnali un problema.

---

## 8. Leggere i dati

### 8.1 La tabella meteo

La tabella mostra le informazioni ora per ora:

- **Prima riga:** ora e distanza percorsa.
- **Seconda riga:** icone meteo, con gli indicatori di cambio di fornitore quando
  serve.
- **Temperatura:** in gradi Celsius o Fahrenheit.
- **Vento:** velocità + freccia della direzione; raffiche tra parentesi.
- **Pioggia:** quantità in mm/h **per l'ora in cui stai pedalando** (probabilità
  tra parentesi). Non è il dato più vicino al minuto esatto del passo, ma quello
  dell'intera ora durante la quale percorrerai quel tratto.
- **Umidità:** percentuale di umidità relativa.
- **Nuvolosità:** percentuale di copertura nuvolosa.
- **Luminosità:** una barra verticale accanto all'icona meteo, nella seconda riga.
  Rappresenta lo 0-100% della luce disponibile in quell'intervallo.
- **UV:** indice ultravioletto (intero), nella riga combinata "Nuvole / UV".

### 8.2 Indicatori di cambio di fornitore

Quando la fonte dei dati cambia lungo il percorso vedrai un'etichetta abbreviata
sopra i dati di quella colonna:

- **OPM** — Open-Meteo
- **ARM** — AROME-HD
- **OPW** — OpenWeather

Compaiono in modalità normale, in confronta fornitori e in confronta date, e
indicano esattamente quale fornitore dà i dati per ogni tratto di tempo. Sono
particolarmente utili con le catene, dove si combinano più fonti.

### 8.3 La mappa

- **Frecce blu:** vento debole (<12 km/h)
- **Frecce rosse:** vento forte (30-50 km/h)
- **Frecce viola:** vento molto forte (>50 km/h)
- **Gocce 💧:** precipitazioni previste
- **Indicatori verde/rosso:** partenza e arrivo del percorso

---

## 9. Funzioni avanzate

### 9.1 Scorrere la tabella in orizzontale

La tabella è interattiva e adatta al tocco:

- Trascina la tabella in orizzontale o usa la rotellina del mouse per scorrere le
  colonne (gesti e *drag-to-scroll*).
- Fai clic su una colonna —o su una cella qualsiasi, per selezionare quella
  colonna— e la riga e la mappa vengono evidenziate.
- La mappa si ricentra sul punto selezionato se fai clic su una freccia del vento
  o sulla colonna.
- Se la penultima colonna dista meno di 5 minuti dall'ultima, l'app la nasconde
  per evitare doppioni visivi.
- La piccola icona ⇆ indica che, scorrendo, ci sono altre colonne.

### 9.2 Informazioni sul sole

L'app mostra in automatico:

- Gli orari di alba e tramonto.
- Il crepuscolo civile, indicato con "c".
- La luminosità calcolata in base all'ora e alle condizioni.

### 9.3 Fonti di riserva intelligenti

MeteoRide gestisce in automatico:

- Il passaggio a Open-Meteo, **solo per i passi interessati**, se il tuo
  fornitore supera il suo orizzonte temporale, fallisce ripetutamente o non ha
  dati per quel punto.
- I nuovi tentativi quando ci sono errori temporanei.
- Un breve avviso nell'intestazione quando succede, se lasci attivi gli avvisi
  non critici in Impostazioni ([§7.2](#72-avvisi-non-critici)).

Ogni richiesta ha una scadenza: **15 secondi** perché il server inizi a rispondere
e **altri 15 secondi** senza ricevere dati durante lo scaricamento. A un fornitore
che smette di rispondere non si chiede più nulla durante quello stesso calcolo: i
passi rimanenti vanno direttamente alla fonte di riserva invece di aspettare che
vada in timeout ancora e ancora.

### 9.4 URL con parametri

Puoi aprire MeteoRide con il percorso e i parametri già impostati:

- `?gpx_url=https://example.com/route.gpx`
- `?datetime=2024-03-15T10:00`
- `?speed=25`

Si possono combinare. Il GPX viene scaricato dal browser direttamente da
quell'URL: MeteoRide non lo carica da nessuna parte.

### 9.5 Percorsi recenti

MeteoRide conserva in locale i file GPX più recenti che hai caricato, così puoi
riaverli senza caricare di nuovo il file.

- **Come si usa:** accanto al pulsante 📁 c'è un menu a tendina con i tuoi
  percorsi recenti. Scegline uno e si carica esattamente come se lo avessi
  caricato adesso.
- **Limite:** vengono conservati gli ultimi **5** percorsi. Se ricarichi un
  percorso già salvato, sale in cima invece di essere duplicato.
- **Dimensione consigliata:** fino a circa **750 KB** per GPX. Se il tuo è molto
  più grande, riducilo oppure pubblicalo online e caricalo con `?gpx_url=`.
- **Privacy:** i file GPX sono salvati nel tuo browser con IndexedDB (o
  localStorage come riserva). Non vengono mai condivisi fuori dal tuo
  dispositivo.
- **Efficienza:** in memoria vengono tenute solo le informazioni di base (nome,
  dimensione e data); il contenuto completo viene letto solo quando scegli il
  percorso.

### 9.6 Cache locale e prestazioni

Le risposte dei fornitori vengono salvate in `localStorage` per circa
**30 minuti** per passo/ora. Questo velocizza i ricaricamenti frequenti e riduce
le richieste alle API con limiti di frequenza. Scade da sola: non c'è nulla da
cancellare a mano.

---

## 10. Limiti e consigli

### Limiti

- **Orizzonte temporale:** Open-Meteo 14 giorni, OpenWeather 4 giorni, AROME-HD
  36 ore.
- **Precisione:** le previsioni sono decisamente meno affidabili dal 3°-4° giorno
  in poi.
- **API gratuite:** Open-Meteo non richiede chiave e non ha limiti pratici;
  OpenWeather offre un livello gratuito, ma le chiavi possono avere limiti d'uso
  mensili.
- **MeteoRide non modifica il percorso.** Legge soltanto il GPX/KML.

### Buone pratiche

- Usa percorsi di 100-200 km al massimo per prestazioni migliori.
- Pianifica con 1-2 giorni di anticipo per una maggiore precisione.
- Combina le informazioni di più fonti per le decisioni importanti.
- Abbi sempre un piano B per le condizioni avverse.
- Porta l'antipioggia anche se la probabilità è bassa.

---

## 11. Allerte meteo ufficiali

MeteoRide può mostrare gli avvisi e le allerte ufficiali pubblicati dai servizi
meteorologici nazionali, quando compaiono nell'array `alerts` di OpenWeather.

Per attivarle: inserisci la tua **chiave API di OpenWeather** in Impostazioni e
spunta **Mostra le allerte meteo ufficiali**.

- **Disponibilità:** richiede una chiave di OpenWeather, perché è l'unico
  fornitore che le pubblica. Con la chiave configurata, MeteoRide controlla le
  allerte anche quando OpenWeather non è il fornitore principale scelto. Senza
  chiave la casella è disattivata e ne spiega il motivo.
- **Visibilità:** quando viene rilevata un'allerta compare una scheda informativa
  che si nasconde da sola dopo 15 secondi. Nell'interfaccia resta un indicatore
  **⚠️** fisso per riaprire tutte le allerte rilevate.
- **Campionamento ed efficienza:** per limitare le chiamate all'API si controlla
  un campione rappresentativo di punti lungo il percorso (circa 2/3 dei passi,
  minimo 3). Le risposte delle allerte restano in cache locale per ~1 ora.
- **Finestra temporale:** si considerano solo le allerte il cui periodo
  (inizio/fine) coincide con la finestra temporale del tratto di percorso
  corrispondente, con una tolleranza di ±1 ora attorno al passo.

> **Avviso importante.** Queste allerte sono fornite solo a titolo informativo.
> Non affidarti solo a loro per le decisioni di sicurezza. Consulta sempre il
> servizio meteorologico ufficiale del tuo paese o le autorità competenti prima di
> intraprendere un'attività che potrebbe risentire di condizioni avverse.
> OpenWeather può contenere errori o ritardi, o tralasciare avvisi locali
> specifici; MeteoRide non sostituisce le comunicazioni ufficiali.

---

## 12. Risoluzione dei problemi

| Sintomo | Cosa controllare |
|---|---|
| Il GPX/KML non si carica | Controlla che il file contenga tracce valide. |
| Nessun dato meteo | Controlla la tua chiave API con 🔍 Verifica, oppure passa a Open-Meteo, che non richiede chiave. |
| Data fuori intervallo | Riduci l'orizzonte temporale: ogni fornitore ha il suo ([§4](#4-fornitori-meteo)). |
| Tabella vuota | Assicurati che il percorso sia abbastanza lungo per almeno un passo. |
| Un percorso condiviso non arriva all'app | Riavvia il telefono la prima volta ([§6.2](#62-ricevi-un-percorso-da-unaltra-app)). |
| Gli avvisi di cambio del meteo non arrivano | Leggi cosa dice l'app sotto l'interruttore ([§6.3](#63-avvisi-quando-il-meteo-sul-tuo-percorso-cambia)). |

Per segnalare un problema, attiva il pulsante di debug ([§7.5](#75-pulsante-di-debug))
e indica il tuo dispositivo e la versione, che trovi in fondo alla pagina di aiuto.

---

## 13. Privacy e dati

L'informativa vera e propria — cosa riceve ogni fornitore, per quanto lo conserva
e come cancellare tutto ciò che resta sul dispositivo — è
[quella del sito](https://app.meteoride.cc/privacy-web-it.html),
[quella di iOS](https://app.meteoride.cc/privacy-ios-it.html) e
[quella di Android](https://app.meteoride.cc/privacy-android-it.html) — una per
piattaforma, che è quella fornita al modulo di ogni store, e le app sono più chiuse
del sito. Questa sezione è il riassunto; quella che deve essere giusta è
l'informativa.

**MeteoRide funziona interamente sul tuo dispositivo.** Tutte le impostazioni, le
preferenze e i dati sono salvati solo sul tuo dispositivo: nel browser
(localStorage e IndexedDB) sul sito, e nell'app anche nella memoria propria del
sistema, così che iOS non possa cancellare le impostazioni.

L'unica eccezione è il sito: se usi i Comandi rapidi di iOS per condividere un
GPX, quel file viene caricato su Cloudflare. È inevitabile perché i Comandi rapidi
di iOS accettano solo POST. Se apri il file direttamente da MeteoRide non viene
caricato nulla, perché viene elaborato in locale, e l'app nativa non ne ha
affatto bisogno. In ogni caso il GPX caricato viene cancellato automaticamente
entro due minuti al massimo.

- **Nessun account:** non devi creare un account né fornire dati personali.
- **Controllo totale:** sul sito, cancella i dati del sito dalle impostazioni
  del browser; nell'app, disinstallala (iPhone) o cancellane la memoria
  (Android). L'informativa della tua piattaforma spiega cosa succede con i
  backup.
- **Codice aperto:** puoi esaminare tutto il codice sorgente su GitHub.

### Dati condivisi con i fornitori meteo

Per ottenere le previsioni, MeteoRide condivide solo:

- Le **coordinate geografiche** dei punti del tuo percorso.
- Le **date e gli orari** per cui ti serve la previsione.
- **La tua chiave API**, se usi OpenWeather.

I fornitori meteo (Open-Meteo, OpenWeather) hanno le loro informative sulla
privacy. MeteoRide agisce solo come client che chiede i dati di previsione che ti
servono.

### Sulla chiave API

La chiave è salvata nella memoria locale del tuo dispositivo, **senza
cifratura**. Questo significa che in teoria potrebbe accedervi una terza persona
con accesso al tuo dispositivo, o un altro script in esecuzione nel tuo browser.
Il rischio con questo tipo di chiave è basso, ma si consiglia di usare una chiave
gratuita con permessi minimi. In alternativa, puoi fare a meno delle chiavi e
affidarti ai fornitori che non le richiedono (Open-Meteo, AROME-HD).

### Cosa viene salvato in locale

- Le impostazioni di unità e lingua.
- Le chiavi API, senza cifratura.
- Le preferenze di velocità e intervallo.
- La cache temporanea dei dati meteo (~30 minuti).
- Gli ultimi 5 percorsi GPX caricati.
- Nell'app nativa, anche le tessere della mappa che hai guardato, ciascuna fino
  alla scadenza indicata dal suo server.

Se ti servono garanzie di privacy più rigorose, puoi usare MeteoRide interamente
in locale (aprendo `index.html` senza usare le funzioni di condivisione/caricamento)
o pubblicare il tuo share-server con le politiche di accesso che decidi tu
([DEPLOY.md](DEPLOY.md)).

---

## 14. Licenza e crediti

Sviluppato da [Lockevod](https://github.com/lockevod).

### Licenza

Questo progetto è distribuito con **licenza MIT**, il che significa che:

- Puoi usare l'applicazione liberamente.
- Puoi modificare il codice sorgente.
- Puoi distribuire la tua versione.
- Per uso personale e commerciale.
- Devi indicare l'autore e la licenza MIT.

### Tecnologie e servizi

- **Mappe:** OpenStreetMap e i suoi contributori.
- **Dati meteo:** Open-Meteo, OpenWeather.
- **Icone meteo:** Weather Icons di Erik Flowers.
- **Librerie:** Leaflet.js, SunCalc, GPX parser.
- **App nativa:** Capacitor (iOS / Android).
- **Hosting:** Cloudflare Pages (solo versione web).
- **Script:** Tampermonkey.

### Marchi e responsabilità

Bikemap, Komoot, OpenWeatherMaps, Openmeteo e Hammerhead sono marchi registrati.
Possono avere licenze proprietarie specifiche; se usi questo codice o la webapp
pubblicata devi rispettarle.

Questo codice e la webapp sono pensati con una sicurezza di tipo "zero trust", ma
non sono codice né un servizio commerciale. Il codice e la webapp sono forniti
così come sono, senza alcuna garanzia né responsabilità. Lo accetti se scarichi
questo repository, usi il codice o usi la webapp.

Le informazioni aggiornate su questa app sono sempre su
[GitHub](https://github.com/lockevod/MeteoRide). Se usi questa app accetti tutte le
informazioni, le responsabilità e le restrizioni aggiornate di quella pagina.

### Esclusione di responsabilità

MeteoRide è uno strumento di pianificazione. I dati meteo sono stime e potrebbero
non essere del tutto precisi. Usa sempre il buon senso e verifica le condizioni
prima di partire. Lo sviluppatore non è responsabile delle decisioni prese in base
a queste informazioni.

---

## 15. Supporto e contributi

### Segnala problemi

- Apri una segnalazione nel
  [repository GitHub](https://github.com/lockevod/MeteoRide/issues).
- Attiva il pulsante di debug (🐞) in **Impostazioni → Mostra il pulsante di
  debug**: all'inizio è disattivato.
- Indica il tuo dispositivo e la versione, che trovi in fondo alla pagina di
  aiuto.

### Contribuisci

- Fai un fork del repository su GitHub.
- Segnala bug o suggerisci miglioramenti.
- Traduci in nuove lingue.
- Migliora la documentazione.

Il meteo può cambiare in fretta. Usa MeteoRide come guida, ma resta flessibile e
prudente nelle tue uscite.
