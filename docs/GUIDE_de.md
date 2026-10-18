# Benutzerhandbuch von MeteoRide

Die Hilfe in der App beantwortet die Frage „Was muss ich tun?“. Dieses Handbuch
beantwortet „Warum?“ und „Was passiert, wenn …?“. Hier stehen alle Details: die
Grenzen jedes Anbieters, was die App wo speichert, wie sie sich ohne Netz verhält
und jede Installationsanleitung.

Versión en español: [GUIA.md](GUIA.md) · English version: [GUIDE.md](GUIDE.md) ·
Hilfe in der App: [help_de.html](https://app.meteoride.cc/help_de.html)

---

## 1. Was MeteoRide ist

MeteoRide ist eine Anwendung für Radfahrer – im Web und als App für iPhone und
Android –, die GPX/KML-Routen lädt und die Vorhersage entlang der Route anzeigt.

Die App berechnet die Schritte der Route aus dem Tempo, das du wählst, und fragt
bei einem oder mehreren Wetteranbietern Temperatur, Wind, Niederschlag,
Luftfeuchtigkeit, Bewölkung, Licht und UV-Index für jeden dieser Schritte ab. Sie
hat automatische Ersatzanbieter, damit du auch dann Daten bekommst, wenn ein
Anbieter ausfällt, und sie kann Vorhersagen verschiedener Quellen oder für zwei
verschiedene Daten vergleichen.

MeteoRide bearbeitet die Route nicht: Es liest sie nur.

---

## 2. Erste Schritte

### 2.1 GPX/KML-Route laden

Klicke auf die Taste **📁** und wähle deine Datei. Unterstützt werden normale
GPX- und KML-Tracks, -Routen und -Wegpunkte.

Du kannst eine Route auch über einen Link mit den in
[§9.4](#94-urls-mit-parametern) beschriebenen Parametern laden oder sie aus einer
anderen App teilen, wenn du die native App nutzt
([§6](#6-in-der-app-für-iphone-und-android)).

### 2.2 Datum und Uhrzeit

Wähle, wann du losfahren willst. Die Zeit rastet von selbst auf
15-Minuten-Schritte ein.

### 2.3 Tempo

Gib deinen geschätzten Schnitt ein oder nimm einen der Vorgabewerte: 5, 10, 12,
15 oder 20 km/h. Aus diesem Tempo ergibt sich, wann du an jedem Punkt bist,
deshalb verändert es das Ergebnis am stärksten.

### 2.4 Intervall

Wähle, wie oft du Wetterinfos sehen willst: alle 15 oder 30 Minuten.

### 2.5 Anbieter

Wähle den Anbieter oder die Anbieterkette, die du nutzen willst. Beschrieben sind
sie in [§4](#4-wetteranbieter). Was passiert, wenn der gewählte ausfällt, steht
in [§9.3](#93-intelligente-ersatzanbieter).

### 2.6 Modus Anbieter vergleichen (Comp.)

Aktiviere **Comp.**, um die Unterschiede zwischen den Anbietern auf derselben
Route und zur selben Zeit zu sehen.

- Open-Meteo und AROME werden genau wie in der normalen Tabelle gelesen,
  einschließlich der Viertelstundenwerte in den ersten 5 Stunden.
- Antwortet ein Anbieter nicht, nennt der Hinweis den, der ausgefallen ist,
  statt einen allgemeinen Fehler anzuzeigen.

### 2.7 Modus Daten vergleichen

Vergleiche die Vorhersage für dieselbe Route an zwei verschiedenen Daten oder zu
zwei verschiedenen Zeiten.

- Wähle **Daten vergleichen** in der Anbieterliste, um in diesen Modus zu
  wechseln.
- Stelle Datum A und Datum B mit den Datums- und Zeitfeldern ein, die dann
  erscheinen. Die Tasten mit nur einem Symbol klappen das zweite Datum auf.
- Tippe auf **🔄 Vergleichen**, um die Tabelle zu aktualisieren.
- Die Tabelle zeigt 4 Zeilen: Intervalle für Datum A, Übersicht für Datum A,
  Intervalle für Datum B, Übersicht für Datum B.
- **Es gibt keine automatische Neuberechnung.** Wenn du etwas änderst, musst du
  wieder auf Vergleichen tippen.

---

## 3. Routen von anderen Seiten laden (Userscripts)

Das Projekt enthält zwei optionale Tampermonkey-Userscripts. Für MeteoRide
brauchst du sie nicht; sie sind Abkürzungen für alle, die auf anderen Seiten
planen. Die Installationsanleitung steht in [USERSCRIPTS.md](USERSCRIPTS.md).

- **Komoot / Bikemap / Hammerhead → MeteoRide**: fügt eine Taste hinzu, die die
  Route, die du gerade ansiehst, direkt in MeteoRide öffnet. Bei Komoot ist der
  GPX-Download nur mit bestimmten Konten möglich; ohne diesen Zugang kann das
  Script die Datei nicht holen.
- **MeteoRide → Hammerhead**: fügt in MeteoRide eine Taste hinzu, die die
  aktuelle GPX-Datei zu Hammerhead (dashboard.hammerhead.io) exportiert. Das
  Script lädt die GPX-Datei unverändert auf einen Share-Server hoch, den du
  einrichtest, und bittet Hammerhead, diese URL zu importieren.

---

## 4. Wetteranbieter

| Anbieter | API-Schlüssel | Reichweite | Abdeckung |
|---|---|---|---|
| Open-Meteo | Nein | 14 Tage | Weltweit |
| OpenWeather | Ja | 4 Tage | Weltweit |
| AROME-HD | Nein | 36 Stunden | Teil Europas |

- **Open-Meteo**: ohne Schlüssel, weltweite Abdeckung, bis zu 14 Tage. Open-Meteo
  wählt sein bestes Modell für die Gegend deines Tracks. Für jede Situation zu
  empfehlen und ideal für langfristige Planung und Routen außerhalb Europas.
- **OpenWeather**: braucht einen API-Schlüssel, bis zu 4 Tage. Ausgezeichnete
  Echtzeitdaten, und es ist **der einzige Anbieter, der amtliche Wetterwarnungen
  veröffentlicht** ([§11](#11-amtliche-wetterwarnungen)). Am besten für sofortige
  Abfahrten und städtische Gebiete.
- **AROME-HD**: hochauflösendes Modell (~1-2 km) von MeteoFrance, abgefragt über
  Open-Meteo und ohne Schlüssel. Nur für Europa verfügbar
  (ca. 39-52°N, 10.5°W-16.5°E) und innerhalb von 36 Stunden. Außerhalb dieses
  Gebiets oder dieses Zeitfensters wechselt es direkt zum besten Modell, das
  Open-Meteo für diesen Ort hat, ohne dass es etwas Besonderes zu melden gibt: Es
  gibt weiterhin Daten. Überlegen bei Wind und kurzfristigem Niederschlag in
  Frankreich und den Nachbarländern.

### Anbieterketten

Ketten verbinden die Stärken mehrerer Anbieter in derselben Tabelle:

- **OpenWeather → AROME-HD → Open-Meteo**: Echtzeitdaten von OpenWeather für die
  erste Stunde, die hyperlokale Genauigkeit von AROME für die nächsten 47 Stunden
  und Open-Meteo für den Rest der Vorhersage. Braucht einen
  OpenWeather-Schlüssel; ohne ihn ist die Option in der Auswahl deaktiviert.

Wähle danach, was du brauchst: Echtzeitgenauigkeit (OpenWeather), lokale
Genauigkeit (AROME-HD) oder langfristige Planung (Open-Meteo).

---

## 5. Als Web-App installieren (PWA)

Die Website von MeteoRide lässt sich als Progressive Web App (PWA) installieren,
für ein Erlebnis nahe an einer nativen App. Dafür muss die Website auf einem
Server laufen, oder du nutzt <https://app.meteoride.cc>.

Wenn du die native App für iPhone oder Android willst, brauchst du nichts davon:
Installiere sie aus dem Store.

Diese Schritte und die anderen Wege zu MeteoRide stehen auch in
[`docs/INSTALL.md`](INSTALL.md).

**Android**

1. Öffne MeteoRide in Chrome.
2. Tippe oben rechts auf das Menü (drei Punkte).
3. Wähle „Zum Startbildschirm hinzufügen“.
4. Bestätige mit „Hinzufügen“.

**iOS (iPhone/iPad)**

1. Öffne MeteoRide in Safari.
2. Tippe auf die Teilen-Taste (Quadrat mit Pfeil).
3. Wähle „Zum Home-Bildschirm“.
4. Tippe oben rechts auf „Hinzufügen“.

**Chrome am Computer**

1. Öffne MeteoRide in Chrome.
2. Klicke auf das Installationssymbol in der Adressleiste oder im Menü.
3. Klicke auf „Installieren“.

**Edge am Computer**

1. Öffne MeteoRide in Edge.
2. Klicke auf das Installationssymbol in der Adressleiste.
3. Klicke auf „Installieren“.

**Safari auf dem Mac**

1. Öffne MeteoRide in Safari.
2. Gehe zu Ablage > Zum Dock hinzufügen.
3. Oder klicke auf die Teilen-Taste und wähle „Zum Dock hinzufügen“.

---

## 6. In der App für iPhone und Android

Das gibt es nur in der nativen App: Es sind Dinge, die ein Browser nicht kann.

### 6.1 Die Route an eine andere App senden

Ist eine Route geladen, öffnet die Taste **📤** in der oberen Leiste das
Teilen-Menü des Systems mit der GPX-Datei im Anhang. Von dort geht sie an deinen
Radcomputer (Hammerhead, Wahoo), an Dateien, an Mail oder wohin du willst. Die
Datei verlässt nie das Gerät: Es gibt keinen Server dazwischen, anders als beim
iOS-Kurzbefehl, den die Website braucht.

### 6.2 Eine Route aus einer anderen App empfangen

Auch umgekehrt: Teile in Komoot, Strava, Bikemap, Dateien oder Mail die
GPX-Datei und wähle **MeteoRide**. Die App öffnet sich mit der bereits geladenen
Route. Genauso mit „In MeteoRide öffnen“ bei einer heruntergeladenen Datei.

Wenn MeteoRide beim ersten Mal nicht im Teilen-Menü erscheint, starte das
Telefon neu: Das System braucht eine Weile, um die App als Ziel zu registrieren.

### 6.3 Warnungen, wenn sich das Wetter auf deiner Route ändert

Eine Vorhersage ist eine Schätzung, Stunden im Voraus. Sobald du eine Route
berechnet hast, behält die App sie im Blick und sagt dir Bescheid, wenn es für
die Stunden, in denen du unterwegs bist, schlechter wird:

- Es war trocken und Regen kommt auf, oder der Regen wird stark.
- Es war ruhig und mäßiger oder starker Wind kommt auf, oder Böen ab etwa
  43 km/h.
- Eine amtliche Warnung wird ausgegeben, die in deine Tour fällt. Dafür braucht
  es einen OpenWeather-Schlüssel und aktivierte amtliche Warnungen.

Jede Änderung wird einmal gemeldet; wird es wieder schlechter, hörst du wieder
davon. Verbesserungen werden nicht gemeldet, und Abschnitte, die du schon
gefahren bist, auch nicht. Die Überwachung endet eine Stunde nach dem letzten
Punkt der Route.

Ein- und ausschalten kannst du sie unter **Einstellungen → Warnungen →
„Benachrichtige mich, wenn sich das Wetter auf der Route ändert“**, von Anfang an
aktiv; eine Zeile darunter zeigt, welche Route bis wann überwacht wird.

**Gut zu wissen:** Die Prüfung führt das Betriebssystem aus, wann es ihm passt,
nicht die App. Auf dem iPhone muss die Hintergrundaktualisierung für MeteoRide
eingeschaltet sein (Einstellungen → Allgemein), und der Stromsparmodus setzt sie
aus. Unter Android beenden manche Hersteller Hintergrundaufgaben mit ihrem
eigenen Akku-Manager. Wenn das System sie nicht ausführen wird, sagt die App das
unter dem Schalter, statt dich glauben zu lassen, dass über dich gewacht wird.

### 6.4 Ohne Netz

Das Wetter lässt sich nicht erfinden, aber was schon heruntergeladen wurde, wird
nicht weggeworfen:

- Beim Öffnen der App kommt die letzte Route mit ihrer Tabelle zurück, ohne
  etwas zu laden.
- Eine ältere Vorhersage wird weiter angezeigt, mit dem Hinweis, wie viele
  Stunden alt sie ist. Bei zwölf ist Schluss.
- Der Kartenhintergrund braucht eine Verbindung. Kacheln, die du angesehen hast,
  werden nur so lange aufbewahrt, wie der Kartenserver es erlaubt (die
  Bedingungen von OpenStreetMap verbieten die Offline-Nutzung), daher kann der
  Hintergrund ohne Netz leer bleiben; die Karte sagt das, und Route und Tabelle
  werden trotzdem angezeigt.
- Wenn es gar keine Daten gibt, sagt die App das, statt einen leeren Bildschirm
  ohne Erklärung zu zeigen.

Die Taste **📴** speichert die Vorhersage für die geladene Route und schützt sie
vor dem automatischen Aufräumen des Caches. Tippe sie zu Hause an, bevor du
losfährst.

### 6.5 Karte und Einstellungen

- Ohne geladene Route öffnet sich die Karte dort, wo du bist, und nicht in
  Barcelona.
- Die App startet in der Sprache des Telefons, bis du von Hand eine auswählst.
- Einheiten, Sprache, dein API-Schlüssel, letzte Routen und die schon
  angesehenen Kacheln werden außerhalb des internen Browsers gespeichert, in
  einer Form, die WebKit tatsächlich behält: Sie überstehen es, wenn das System
  Speicher freigibt, und auf dem iPhone sind sie beim nächsten Öffnen der App
  noch da. Früher war das nicht so.
- Wenn die Karte dich zum ersten Mal sucht, fragt das System im Namen von
  MeteoRide nach der Standortberechtigung.
- Das Telefon bleibt im Hochformat, weil Drehen das Layout zerstört. Das iPad
  dreht sich mit.

---

## 7. Einstellungen

### 7.1 API-Schlüssel

Nur OpenWeather braucht einen Schlüssel, und nur, wenn du diesen Anbieter oder
die amtlichen Warnungen willst. Du bekommst ihn unter
[openweathermap.org/api](https://openweathermap.org/api) (One Call API).

Neben dem Feld gibt es eine Taste **🔍 Prüfen**: Die App stellt eine einfache
Anfrage und zeigt den Status daneben an (gültig / ungültig / Kontingent /
HTTP-Code). Nutze sie vor dem Losfahren, wenn du den Schlüssel gerade erst
erstellt hast; OpenWeather braucht eine Weile, um ihn zu aktivieren.

### 7.2 Nicht kritische Hinweise

Das Kästchen **Nicht kritische Hinweise anzeigen** steuert, wie gesprächig die
Meldungen sind. Ist es aktiviert, siehst du Info-Banner, wenn wegen
Reichweitengrenzen, Kontingent oder API-Fehlern auf einen Ersatzanbieter
umgeschaltet wird. Ist es deaktiviert, werden nur kritische Fehler angezeigt.

### 7.3 Einheiten

- **Wind:** km/h, m/s, mph
- **Temperatur:** °C, °F
- **Distanz:** km, mi
- **Niederschlag:** mm, in

### 7.4 Sprachen

Die Anwendung gibt es auf Spanisch, Englisch, Katalanisch, Galicisch, Baskisch,
Französisch, Deutsch, Italienisch und Portugiesisch. Die gewählte Sprache ändert
Oberfläche und Meldungen. In der nativen App wird die Sprache des Telefons
genutzt, bis du von Hand eine auswählst.

### 7.5 Debug-Button

**Einstellungen → Debug-Button anzeigen** schaltet die Taste 🐞 ein. Anfangs ist
sie aus. Sie dient dazu, Infos anzuhängen, wenn du ein Problem meldest.

---

## 8. Die Daten lesen

### 8.1 Die Wettertabelle

Die Tabelle zeigt die Infos Stunde für Stunde:

- **Erste Zeile:** Uhrzeit und zurückgelegte Distanz.
- **Zweite Zeile:** Wettersymbole, gegebenenfalls mit Markierungen für den
  Anbieterwechsel.
- **Temperatur:** in Grad Celsius oder Fahrenheit.
- **Wind:** Geschwindigkeit + Richtungspfeil; Böen in Klammern.
- **Regen:** Menge in mm/h **für die Stunde, in der du fährst**
  (Wahrscheinlichkeit in Klammern). Es ist nicht der Wert, der der genauen Minute
  des Schritts am nächsten liegt, sondern der für die ganze Stunde, in der du
  diesen Abschnitt zurücklegst.
- **Luftfeuchtigkeit:** relative Luftfeuchtigkeit in Prozent.
- **Bewölkung:** Wolkenbedeckung in Prozent.
- **Licht:** ein senkrechter Balken neben dem Wettersymbol, in der zweiten
  Zeile. Er stellt 0-100 % des verfügbaren Lichts in diesem Intervall dar.
- **UV:** UV-Index (ganze Zahl), in der kombinierten Zeile „Wolken / UV“.

### 8.2 Markierungen für den Anbieterwechsel

Wechselt die Datenquelle während der Route, siehst du über den Daten dieser
Spalte ein abgekürztes Label:

- **OPM** — Open-Meteo
- **ARM** — AROME-HD
- **OPW** — OpenWeather

Sie erscheinen im normalen Modus, beim Anbietervergleich und beim
Datumsvergleich und zeigen genau, welcher Anbieter die Daten für jeden
Zeitabschnitt liefert. Besonders nützlich sind sie bei Ketten, die mehrere
Quellen verbinden.

### 8.3 Die Karte

- **Blaue Pfeile:** schwacher Wind (<12 km/h)
- **Rote Pfeile:** starker Wind (30-50 km/h)
- **Lila Pfeile:** sehr starker Wind (>50 km/h)
- **Tropfen 💧:** erwarteter Niederschlag
- **Grüne/rote Marker:** Start und Ziel der Route

---

## 9. Erweiterte Funktionen

### 9.1 Die Tabelle horizontal scrollen

Die Tabelle ist interaktiv und für Touch gemacht:

- Zieh die Tabelle zur Seite oder nutze das Mausrad, um durch die Spalten zu
  scrollen (Gesten und *Drag-to-Scroll*).
- Klicke auf eine beliebige Spalte – oder eine beliebige Zelle, um diese Spalte
  auszuwählen –, dann werden die Zeile und die Karte hervorgehoben.
- Die Karte zentriert sich auf den gewählten Punkt, wenn du auf einen Windpfeil
  oder die Spalte klickst.
- Liegt die vorletzte Spalte weniger als 5 Minuten von der letzten entfernt,
  blendet die App sie aus, um doppelte Anzeigen zu vermeiden.
- Das kleine Symbol ⇆ zeigt an, dass es beim Scrollen weitere Spalten gibt.

### 9.2 Sonneninformationen

Die App zeigt automatisch:

- Sonnenaufgangs- und Sonnenuntergangszeiten.
- Bürgerliche Dämmerung, mit „c“ markiert.
- Die nach Uhrzeit und Bedingungen berechnete Helligkeit.

### 9.3 Intelligente Ersatzanbieter

MeteoRide erledigt automatisch:

- Den Wechsel zu Open-Meteo, **nur für die betroffenen Schritte**, wenn dein
  Anbieter seine Reichweite überschreitet, wiederholt ausfällt oder für diesen
  Punkt keine Daten hat.
- Neue Versuche bei vorübergehenden Fehlern.
- Einen kurzen Hinweis in der Kopfzeile, wenn das passiert, falls du die nicht
  kritischen Hinweise in den Einstellungen eingeschaltet lässt
  ([§7.2](#72-nicht-kritische-hinweise)).

Jede Anfrage hat eine Frist: **15 Sekunden**, bis der Server zu antworten
beginnt, und **weitere 15 Sekunden** ohne empfangene Daten während des
Downloads. Ein Anbieter, der verstummt, wird in derselben Berechnung nicht noch
einmal gefragt: Die restlichen Schritte gehen direkt an den Ersatzanbieter,
statt immer wieder auf sein Zeitlimit zu warten.

### 9.4 URLs mit Parametern

Du kannst MeteoRide mit der Route und den Parametern schon eingestellt öffnen:

- `?gpx_url=https://example.com/route.gpx`
- `?datetime=2024-03-15T10:00`
- `?speed=25`

Sie lassen sich kombinieren. Die GPX-Datei lädt der Browser direkt von dieser
URL herunter: MeteoRide lädt sie nirgendwohin hoch.

### 9.5 Letzte Routen

MeteoRide speichert die zuletzt geladenen GPX-Dateien lokal, damit du sie
zurückholen kannst, ohne die Datei erneut hochzuladen.

- **So geht’s:** Neben der Taste 📁 gibt es eine Auswahlliste mit deinen letzten
  Routen. Wähle eine aus, und sie lädt genau so, als hättest du sie gerade
  hochgeladen.
- **Grenze:** Die letzten **5** Routen werden gespeichert. Lädst du eine Route
  erneut, die schon gespeichert ist, rückt sie nach oben, statt doppelt
  aufzutauchen.
- **Empfohlene Größe:** bis etwa **750 KB** pro GPX-Datei. Ist deine viel
  größer, kürze sie oder lege sie online ab und lade sie mit `?gpx_url=`.
- **Datenschutz:** GPX-Dateien werden in deinem Browser mit IndexedDB gespeichert
  (oder ersatzweise mit localStorage). Sie werden nie außerhalb deines Geräts
  geteilt.
- **Effizienz:** Nur die Grunddaten (Name, Größe und Datum) bleiben im Speicher;
  der vollständige Inhalt wird erst gelesen, wenn du die Route auswählst.

### 9.6 Lokaler Cache und Leistung

Antworten der Anbieter werden etwa **30 Minuten** pro Schritt/Stunde in
`localStorage` gespeichert. Das beschleunigt häufiges Neuladen und verringert
die Anfragen an APIs mit Nutzungsgrenzen. Sie laufen von selbst ab: Von Hand
musst du nichts löschen.

---

## 10. Grenzen und Tipps

### Grenzen

- **Reichweite:** Open-Meteo 14 Tage, OpenWeather 4 Tage, AROME-HD 36 Stunden.
- **Genauigkeit:** Ab Tag 3-4 sind Vorhersagen deutlich weniger zuverlässig.
- **APIs:** Open-Meteo braucht keinen Schlüssel und hat praktisch keine Grenze;
  OpenWeather-Schlüssel können monatliche Nutzungsgrenzen haben, die OpenWeather
  festlegt.
- **MeteoRide bearbeitet die Route nicht.** Es liest nur die GPX/KML-Datei.

### Empfehlungen

- Nutze Routen von höchstens 100-200 km für eine bessere Leistung.
- Plane 1-2 Tage im Voraus, das ist genauer.
- Verbinde Infos aus mehreren Quellen, wenn die Entscheidung wichtig ist.
- Hab immer einen Plan B für schlechte Bedingungen.
- Nimm Regenkleidung mit, auch wenn die Wahrscheinlichkeit gering ist.

---

## 11. Amtliche Wetterwarnungen

MeteoRide kann die amtlichen Warnungen und Hinweise der nationalen Wetterdienste
anzeigen, wenn sie im Array `alerts` von OpenWeather auftauchen.

So aktivierst du sie: Trag deinen **OpenWeather-API-Schlüssel** in den
Einstellungen ein und aktiviere **Amtliche Wetterwarnungen anzeigen**.

- **Verfügbarkeit:** braucht einen OpenWeather-Schlüssel, weil es der einzige
  Anbieter ist, der sie veröffentlicht. Mit eingetragenem Schlüssel prüft
  MeteoRide Warnungen auch dann, wenn OpenWeather nicht dein gewählter
  Hauptanbieter ist. Ohne Schlüssel ist das Kästchen deaktiviert und sagt, warum.
- **Sichtbarkeit:** Wird eine Warnung erkannt, erscheint eine Infokarte, die
  sich nach 15 Sekunden von selbst ausblendet. In der Oberfläche bleibt eine
  dauerhafte Anzeige **⚠️**, mit der du alle erkannten Warnungen wieder öffnen
  kannst.
- **Stichprobe und Effizienz:** Um API-Aufrufe zu begrenzen, wird eine
  repräsentative Auswahl von Punkten entlang der Route geprüft (ca. 2/3 der
  Schritte, mindestens 3). Die Antworten zu Warnungen werden etwa 1 Stunde
  lokal zwischengespeichert.
- **Zeitfenster:** Berücksichtigt werden nur Warnungen, deren Zeitraum
  (Beginn/Ende) sich mit dem Zeitfenster des jeweiligen Routenabschnitts
  überschneidet, mit einer Toleranz von ±1 Stunde um den Schritt.

> **Wichtiger Hinweis.** Diese Warnungen dienen nur zur Information. Verlass
> dich bei Sicherheitsentscheidungen nicht allein auf sie. Prüfe immer den
> amtlichen Wetterdienst deines Landes oder die zuständigen Behörden, bevor du
> etwas unternimmst, das von schweren Wetterbedingungen betroffen sein könnte.
> OpenWeather kann Fehler oder Verzögerungen enthalten oder bestimmte lokale
> Warnungen auslassen; MeteoRide ersetzt keine amtlichen Mitteilungen.

---

## 12. Fehlerbehebung

| Problem | Was du prüfen solltest |
|---|---|
| Die GPX/KML-Datei lädt nicht | Prüfe, ob die Datei gültige Tracks enthält. |
| Keine Wetterdaten | Prüfe deinen API-Schlüssel mit 🔍 Prüfen oder wechsle zu Open-Meteo, das keinen Schlüssel braucht. |
| Datum außerhalb des Bereichs | Verkürze den Zeitraum: Jeder Anbieter hat seine eigene Reichweite ([§4](#4-wetteranbieter)). |
| Leere Tabelle | Achte darauf, dass die Route lang genug für mindestens einen Schritt ist. |
| Eine geteilte Route kommt nicht in der App an | Starte das Telefon beim ersten Mal neu ([§6.2](#62-eine-route-aus-einer-anderen-app-empfangen)). |
| Die Warnungen bei Wetteränderung kommen nicht an | Lies, was die App unter dem Schalter anzeigt ([§6.3](#63-warnungen-wenn-sich-das-wetter-auf-deiner-route-ändert)). |

Um ein Problem zu melden, schalte die Debug-Taste ein ([§7.5](#75-debug-button))
und gib dein Gerät und die Version an, die unten auf der Hilfeseite steht.

---

## 13. Datenschutz und Daten

Die eigentliche Datenschutzerklärung – was jeder Anbieter erhält, wie lange er es
aufbewahrt und wie du alles löschst, was auf dem Gerät bleibt – ist die
[der Website](https://app.meteoride.cc/privacy-web-de.html),
[von iOS](https://app.meteoride.cc/privacy-ios-de.html) und
[von Android](https://app.meteoride.cc/privacy-android-de.html) – eine pro Plattform,
so wie sie jeweils im Formular jedes Stores angegeben wird, und die Apps sind
geschlossener als die Website. Dieser Abschnitt ist die Zusammenfassung; maßgeblich
ist die Datenschutzerklärung.

**MeteoRide läuft vollständig auf deinem Gerät.** Alle Einstellungen, Vorlieben
und Daten werden nur in deinem Browser gespeichert, mit localStorage und
IndexedDB.

Die einzige Ausnahme ist die Website: Wenn du die iOS-Kurzbefehle nutzt, um eine
GPX-Datei zu teilen, wird diese Datei zu Cloudflare hochgeladen. Das lässt sich
nicht vermeiden, weil iOS-Kurzbefehle nur POST akzeptieren. Öffnest du die Datei
direkt in MeteoRide, wird nichts hochgeladen, weil sie lokal verarbeitet wird,
und die native App braucht das überhaupt nicht. In jedem Fall wird die
hochgeladene GPX-Datei spätestens nach zwei Minuten automatisch gelöscht.

- **Kein Konto:** Du musst kein Konto anlegen und keine persönlichen Daten angeben.
- **Volle Kontrolle:** Du kannst alle gespeicherten Daten in den Einstellungen
  deines Browsers löschen.
- **Open Source:** Du kannst den gesamten Quellcode auf GitHub einsehen.

### An die Wetteranbieter übermittelte Daten

Um Vorhersagen zu bekommen, teilt MeteoRide nur:

- Die **geografischen Koordinaten** der Punkte deiner Route.
- Die **Daten und Uhrzeiten**, für die du die Vorhersage brauchst.
- **Deinen API-Schlüssel**, wenn du OpenWeather nutzt.

Die Wetteranbieter (Open-Meteo, OpenWeather) haben eigene
Datenschutzerklärungen. MeteoRide tritt nur als Client auf, der die
Vorhersagedaten abfragt, die du brauchst.

### Zum API-Schlüssel

Der Schlüssel wird im lokalen Speicher deines Geräts gespeichert, **nicht
verschlüsselt**. Theoretisch könnte also ein Dritter mit Zugriff auf dein Gerät
oder ein anderes Script, das in deinem Browser läuft, darauf zugreifen. Bei
dieser Art von Schlüssel ist das Risiko gering, aber ratsam ist ein Schlüssel
mit minimalen Berechtigungen, den du für nichts anderes nutzt. Alternativ kannst
du ganz auf Schlüssel verzichten und die Anbieter nutzen, die keinen brauchen
(Open-Meteo, AROME-HD).

### Was lokal gespeichert wird

- Einstellungen für Einheiten und Sprache.
- API-Schlüssel, unverschlüsselt.
- Vorlieben für Tempo und Intervall.
- Temporärer Cache der Wetterdaten (~30 Minuten).
- Die letzten 5 geladenen GPX-Routen.
- In der nativen App außerdem die Kartenkacheln, die du angesehen hast, jede bis
  zu dem Ablaufdatum, das ihr Server ihr gegeben hat.

Wenn du strengere Datenschutzgarantien brauchst, kannst du MeteoRide komplett
lokal betreiben (indem du `index.html` öffnest, ohne die Teilen-/Hochladen-Funktionen
zu nutzen) oder deinen eigenen Share-Server mit den Zugriffsregeln aufsetzen, die
du festlegst ([DEPLOY.md](DEPLOY.md)).

---

## 14. Lizenz und Danksagung

Entwickelt von [Lockevod](https://github.com/lockevod).

### Lizenz

Dieses Projekt steht unter der **MIT-Lizenz**, das heißt:

- Du darfst die Anwendung frei nutzen.
- Du darfst den Quellcode ändern.
- Du darfst deine eigene Version weitergeben.
- Für private und kommerzielle Nutzung.
- Du musst den Autor und die MIT-Lizenz nennen.

### Technologien und Dienste

- **Karten:** OpenStreetMap und Mitwirkende.
- **Wetterdaten:** Open-Meteo, OpenWeather.
- **Wettersymbole:** Weather Icons von Erik Flowers.
- **Bibliotheken:** Leaflet.js, SunCalc, GPX parser.
- **Native App:** Capacitor (iOS / Android).
- **Hosting:** Cloudflare Pages (nur die Webversion).
- **Scripts:** Tampermonkey.

### Marken und Haftung

Bikemap, Komoot, OpenWeatherMaps, Openmeteo und Hammerhead sind eingetragene
Marken. Sie können eigene proprietäre Lizenzen haben; wenn du diesen Code oder
die veröffentlichte Web-App nutzt, musst du sie einhalten.

Dieser Code und die Web-App sind mit Blick auf Sicherheit nach dem Prinzip
„Zero Trust“ entworfen, aber sie sind weder kommerzieller Code noch ein
kommerzieller Dienst. Code und Web-App werden so bereitgestellt, wie sie sind,
ohne jede Gewährleistung oder Haftung. Das akzeptierst du, wenn du dieses
Repository herunterlädst, den Code nutzt oder die Web-App verwendest.

Aktuelle Infos über diese App stehen immer auf
[GitHub](https://github.com/lockevod/MeteoRide). Wenn du diese App nutzt,
akzeptierst du alle aktuellen Infos, Haftungsregeln und Einschränkungen auf
dieser Seite.

### Haftungsausschluss

MeteoRide ist ein Planungswerkzeug. Wetterdaten sind Schätzungen und können
ungenau sein. Verlass dich immer auf dein eigenes Urteil und prüfe die
Bedingungen vor dem Losfahren. Der Entwickler ist nicht verantwortlich für
Entscheidungen, die auf diesen Infos beruhen.

---

## 15. Support und Mitwirkung

### Probleme melden

- Eröffne ein Issue im
  [GitHub-Repository](https://github.com/lockevod/MeteoRide/issues).
- Schalte die Debug-Taste (🐞) unter **Einstellungen → Debug-Button anzeigen**
  ein: Sie ist anfangs aus.
- Gib dein Gerät und die Version an, die unten auf der Hilfeseite steht.

### Mitwirken

- Forke das Repository auf GitHub.
- Melde Fehler oder schlage Verbesserungen vor.
- Übersetze in neue Sprachen.
- Verbessere die Dokumentation.

Das Wetter kann schnell umschlagen. Nutze MeteoRide als Orientierung, aber bleib
flexibel und sicher auf deinen Touren.
