# Guide d’utilisation de MeteoRide

L’aide intégrée à l’app répond à « que dois-je faire ? ». Ce guide répond à
« pourquoi » et à « que se passe-t-il si ». Tout le détail se trouve ici : les
limites de chaque fournisseur, ce que l’app stocke et où, son comportement sans
réseau, et comment obtenir les apps ou faire tourner votre propre copie.

Versión en español: [GUIA.md](GUIA.md) · English version: [GUIDE.md](GUIDE.md) · Aide dans l’app :
[help_fr.html](https://app.meteoride.cc/help_fr.html)

---

## 1. Qu’est-ce que MeteoRide

MeteoRide est une application pour cyclistes —sur le web et en app pour iPhone
et Android— qui charge des parcours GPX/KML et affiche les prévisions tout au
long du parcours.

L’app calcule les étapes du parcours à partir de la vitesse que vous choisissez
et demande à un ou plusieurs fournisseurs météo la température, le vent, les
précipitations, l’humidité, la nébulosité, la luminosité et l’indice UV à chacune
de ces étapes. Elle prévoit des sources de secours automatiques pour que vous
ayez des données même quand un fournisseur échoue, et elle peut comparer les
prévisions de plusieurs sources ou pour deux dates différentes.

MeteoRide ne modifie pas le parcours : il se contente de le lire.

---

## 2. Premiers pas

### 2.1 Charger un parcours GPX/KML

Cliquez sur le bouton **📁** et choisissez votre fichier. Les traces, itinéraires
et points de passage GPX et KML standard sont pris en charge.

Vous pouvez aussi charger un parcours depuis un lien avec les paramètres décrits
en [§9.4](#94-url-avec-paramètres), ou le partager depuis une autre app si vous
utilisez l’app native ([§6](#6-dans-lapp-iphone-et-android)).

### 2.2 Date et heure

Choisissez quand vous comptez partir. L’heure s’ajuste automatiquement par
tranches de 15 minutes.

### 2.3 Vitesse

Saisissez votre vitesse moyenne estimée ou utilisez l’une des valeurs
prédéfinies : 5, 10, 12, 15 ou 20 km/h. L’heure à laquelle vous serez à chaque
point découle de cette vitesse : c’est donc elle qui change le plus le résultat.

### 2.4 Intervalle

Choisissez à quelle fréquence vous voulez des informations météo : toutes les 15
ou 30 minutes.

### 2.5 Fournisseur

Choisissez le fournisseur ou la chaîne de fournisseurs à utiliser. Ils sont
décrits en [§4](#4-fournisseurs-météo). Ce qui se passe quand celui que vous avez
choisi échoue est expliqué en [§9.3](#93-sources-de-secours-intelligentes).

### 2.6 Mode comparer les fournisseurs

Choisissez **Comparer** dans la liste des fournisseurs pour évaluer les
différences entre fournisseurs sur le même parcours et à la même heure.

- Il lit Open-Meteo et AROME exactement comme le tableau normal, y compris les
  données au quart d’heure dans les 5 premières heures.
- Si un fournisseur ne répond pas, l’avis nomme celui qui a échoué au lieu
  d’afficher une erreur générique.

### 2.7 Mode comparer des dates

Comparez les prévisions pour le même parcours à deux dates ou heures différentes.

- Appuyez sur **⇄** à côté de la date pour entrer dans ce mode.
- Réglez la date A et la date B ; la seconde date apparaît sous la première.
- Appuyez sur **⟲** pour mettre à jour le tableau.
- Le tableau affiche 4 lignes : intervalles de la date A, résumé de la date A,
  intervalles de la date B, résumé de la date B.
- **Il n’y a pas de recalcul automatique.** Si vous changez une commande, vous
  devez appuyer de nouveau sur ⟲.

---

## 3. Charger des parcours depuis d’autres sites (userscripts)

Le projet comprend deux userscripts Tampermonkey facultatifs. Ils ne sont pas
nécessaires pour utiliser MeteoRide ; ce sont des raccourcis pour ceux qui
préparent leurs sorties sur d’autres sites. Les instructions d’installation sont
dans [USERSCRIPTS.md](USERSCRIPTS.md).

- **Komoot / Bikemap / Hammerhead → MeteoRide** : ajoute un bouton qui ouvre
  directement dans MeteoRide le parcours que vous consultez. Sur Komoot, le
  téléchargement du GPX n’est possible qu’avec un compte **Premium** ; sans lui,
  le script ne peut pas récupérer le fichier.
- **MeteoRide → Hammerhead** : ajoute dans MeteoRide un bouton qui exporte le GPX
  en cours vers Hammerhead (dashboard.hammerhead.io). Le script envoie le GPX
  brut à un share-server que vous configurez et demande à Hammerhead d’importer
  cette URL.

---

## 4. Fournisseurs météo

| Fournisseur | Clé API | Horizon | Couverture |
|---|---|---|---|
| Open-Meteo | Non | 14 jours | Mondiale |
| OpenWeather | Oui | 4 jours | Mondiale |
| AROME-HD | Non | 36 heures | Une partie de l’Europe |

- **Open-Meteo** : sans clé, couverture mondiale, jusqu’à 14 jours. Open-Meteo
  choisit son meilleur modèle pour la zone de votre trace. Recommandé dans toutes
  les situations, et idéal pour préparer longtemps à l’avance et pour les
  parcours hors d’Europe.
- **OpenWeather** : demande une clé API, jusqu’à 4 jours. Excellentes données en
  temps réel, et c’est **le seul fournisseur qui publie les vigilances météo
  officielles** ([§11](#11-vigilances-météo-officielles)). Le meilleur pour un
  départ imminent et en zone urbaine.
- **AROME-HD** : modèle haute résolution (~1-2 km) de Météo-France, accessible
  via Open-Meteo et sans clé. Disponible uniquement pour l’Europe
  (env. 39-52° N, 10,5° O-16,5° E) et dans les 36 heures. Hors de cette zone ou
  de cette fenêtre, il passe directement au meilleur modèle dont Open-Meteo
  dispose pour ce lieu, sans rien d’anormal à signaler : il y a toujours des
  données. Supérieur pour le vent et les précipitations à court terme en France
  et dans les pays voisins.

### Chaînes de fournisseurs

Les chaînes combinent les points forts de plusieurs fournisseurs dans le même
tableau :

- **OpenWeather → AROME-HD → Open-Meteo** : données en temps réel d’OpenWeather
  pour la première heure, précision hyperlocale d’AROME pour les 47 heures
  suivantes, et Open-Meteo pour le reste des prévisions. Demande une clé
  OpenWeather ; sans elle, l’option est désactivée dans le sélecteur.

Choisissez selon votre besoin : la précision en temps réel (OpenWeather), la
précision locale (AROME-HD) ou la préparation à long terme (Open-Meteo).

---

## 5. L’utiliser dans le navigateur

L’appli web fonctionne dans n’importe quel navigateur récent, sur ordinateur ou
sur téléphone, à l’adresse <https://app.meteoride.cc>. Rien à installer.

Pour l’app iPhone ou Android, installez-la depuis l’App Store ou avec l’APK de
GitHub ; les étapes sont dans [`docs/INSTALL.md`](INSTALL.md).

---

## 6. Dans l’app iPhone et Android

Ces fonctions n’existent que dans l’app native : ce sont des choses qu’un
navigateur ne sait pas faire.

### 6.1 Envoyer le parcours vers une autre app

Avec un parcours chargé, le bouton **📤** de la barre du haut ouvre la feuille de
partage du système avec le GPX en pièce jointe. De là, il part vers votre
compteur GPS (Hammerhead, Wahoo), vers Fichiers, par e-mail, où vous voulez. Le
fichier ne quitte jamais l’appareil : il n’y a aucun serveur intermédiaire,
contrairement au Raccourci iOS dont le site a besoin.

### 6.2 Recevoir un parcours depuis une autre app

Dans l’autre sens aussi : dans Komoot, Strava, Bikemap, Fichiers ou la
messagerie, partagez le GPX et choisissez **MeteoRide**. L’app s’ouvre avec le
parcours déjà chargé. Même chose avec « Ouvrir dans MeteoRide » depuis un fichier
téléchargé.

Si MeteoRide n’apparaît pas dans la feuille de partage la première fois,
redémarrez le téléphone : le système met un moment à enregistrer l’app comme
destination.

### 6.3 Alertes quand la météo change sur votre parcours

Une prévision est une estimation faite des heures à l’avance. Quand vous calculez
un parcours, l’app continue de le surveiller et vous prévient s’il se dégrade
pendant les heures où vous serez dehors :

- Il faisait sec et de la pluie apparaît, ou la pluie devient forte.
- C’était calme et un vent modéré ou fort apparaît, ou des rafales à partir
  d’environ 43 km/h.
- Une vigilance officielle est émise qui chevauche votre sortie. Cela demande une
  clé OpenWeather et les vigilances officielles activées.

Chaque changement n’est signalé qu’une fois ; s’il s’aggrave encore, vous êtes
de nouveau prévenu. Les améliorations ne sont pas signalées, pas plus que les
tronçons que vous avez déjà parcourus. La surveillance s’arrête une heure après
le dernier point du parcours.

Activez-la ou désactivez-la dans **Réglages → Alertes → « Me prévenir si la
météo change sur le parcours »**, activé par défaut, où une ligne en dessous
indique quel parcours est surveillé et jusqu’à quand.

**Bon à savoir :** la vérification est lancée par le système d’exploitation
quand bon lui semble, pas par l’app. Sur iPhone, l’actualisation en arrière-plan
doit être activée pour MeteoRide (Réglages → Général), et le mode Économie
d’énergie la suspend. Sur Android, certains fabricants coupent les tâches en
arrière-plan avec leur propre gestionnaire de batterie. Quand le système ne va
pas la lancer, l’app l’indique sous l’interrupteur au lieu de vous laisser croire
que vous êtes surveillé.

### 6.4 Sans réseau

La météo ne s’invente pas, mais ce qui a déjà été téléchargé n’est pas jeté :

- À l’ouverture, l’app retrouve le dernier parcours avec son tableau, sans rien
  charger.
- Des prévisions anciennes restent affichées, avec leur ancienneté en heures.
  Cela s’arrête à douze.
- Le fond de carte a besoin d’une connexion. Les tuiles que vous avez consultées
  ne sont conservées que le temps autorisé par le serveur de cartes (les
  conditions d’OpenStreetMap interdisent l’usage hors connexion) ; sans réseau,
  le fond peut donc rester vide : la carte l’indique, et le parcours et le
  tableau s’affichent quand même.
- Quand il n’y a aucune donnée, l’app le dit au lieu de laisser un écran vide
  sans explication.

Le bouton **📴** enregistre les prévisions du parcours chargé et les protège du
nettoyage automatique du cache. Appuyez dessus chez vous avant de partir.

### 6.5 Carte et réglages

- Sans parcours chargé, la carte s’ouvre là où vous êtes plutôt qu’à Barcelone.
- L’app démarre dans la langue du téléphone jusqu’à ce que vous en choisissiez
  une à la main.
- Les unités, la langue, votre clé API, les parcours récents et les tuiles déjà
  consultées sont conservés hors du navigateur interne, sous une forme que WebKit
  conserve bien : ils survivent quand le système récupère de l’espace et, sur
  iPhone, ils sont toujours là quand vous rouvrez l’app. Ce n’était pas le cas
  avant.
- La première fois que la carte vous localise, le système demande l’autorisation
  de localisation au nom de MeteoRide.
- Le téléphone reste en portrait, car le faire pivoter casse la mise en page.
  L’iPad, lui, pivote.

---

## 7. Réglages

### 7.1 Clés API

Seul OpenWeather demande une clé, et seulement si vous voulez ce fournisseur ou
les vigilances officielles. Elle s’obtient sur
[openweathermap.org/api](https://openweathermap.org/api) (One Call API).

À côté du champ se trouve un bouton **🔍 Vérifier** : l’app fait une requête
simple et affiche l’état à côté (valide / invalide / quota / code HTTP).
Utilisez-le avant de partir si vous venez de créer la clé ; OpenWeather met un
moment à les activer.

### 7.2 Avis non critiques

La case **Afficher les avis non critiques** règle le niveau de détail des
notifications. Cochée, vous verrez des bandeaux d’information quand une source de
secours prend le relais à cause des limites d’horizon, du quota ou d’erreurs
d’API. Décochée, seules les erreurs critiques s’affichent.

### 7.3 Unités

- **Vent :** km/h, m/s, mph
- **Température :** °C, °F
- **Distance :** km, mi
- **Précipitations :** mm, in

### 7.4 Langues

L’application est disponible en espagnol, anglais, catalan, galicien, basque,
français, allemand, italien et portugais. La langue choisie change l’interface et
les messages. Dans l’app native, tant que vous n’en choisissez pas une à la main,
c’est la langue du téléphone qui est utilisée.

### 7.5 Bouton de débogage

**Réglages → Afficher le bouton de débogage** active le bouton 🐞. Il est
désactivé au départ. Il sert à joindre des informations quand vous signalez un
problème.

---

## 8. Interpréter les données

### 8.1 Le tableau météo

Le tableau affiche les informations heure par heure :

- **Première ligne :** heure et distance cumulée.
- **Deuxième ligne :** icônes météo, avec les indicateurs de changement de
  fournisseur le cas échéant.
- **Température :** en degrés Celsius ou Fahrenheit.
- **Vent :** vitesse + flèche de direction ; rafales entre parenthèses.
- **Pluie :** quantité en mm/h **pour l’heure pendant laquelle vous roulez**
  (probabilité entre parenthèses). Ce n’est pas le relevé le plus proche de la
  minute exacte de l’étape, mais celui de toute l’heure pendant laquelle vous
  parcourrez ce tronçon.
- **Humidité :** pourcentage d’humidité relative.
- **Nébulosité :** pourcentage de couverture nuageuse.
- **Luminosité :** une barre verticale à côté de l’icône météo, sur la deuxième
  ligne. Elle représente de 0 à 100 % de la lumière disponible sur cet
  intervalle.
- **UV :** indice ultraviolet (entier), dans la ligne combinée « Nuages / UV ».

### 8.2 Indicateurs de changement de fournisseur

Quand la source des données change en cours de parcours, une étiquette abrégée
apparaît au-dessus des données de la colonne concernée :

- **OPM** — Open-Meteo
- **ARM** — AROME-HD
- **OPW** — OpenWeather

Elles apparaissent en mode normal, en comparaison de fournisseurs et en
comparaison de dates, et indiquent exactement quel fournisseur donne les données
de chaque tranche horaire. Elles sont particulièrement utiles avec les chaînes,
qui combinent plusieurs sources.

### 8.3 La carte

- **Flèches bleues :** vent faible (<12 km/h)
- **Flèches rouges :** vent fort (30-50 km/h)
- **Flèches violettes :** vent très fort (>50 km/h)
- **Gouttes 💧 :** précipitations prévues
- **Marqueurs vert/rouge :** départ et arrivée du parcours

---

## 9. Fonctions avancées

### 9.1 Faire défiler le tableau horizontalement

Le tableau est interactif et adapté au tactile :

- Faites glisser le tableau horizontalement ou utilisez la molette de la souris
  pour faire défiler les colonnes (gestes et *glisser pour défiler*).
- Cliquez sur une colonne —ou sur une cellule, pour sélectionner cette colonne—
  et la ligne et la carte sont mises en évidence.
- La carte se recentre sur le point sélectionné si vous cliquez sur une flèche de
  vent ou sur la colonne.
- Si l’avant-dernière colonne est à moins de 5 minutes de la dernière, l’app la
  masque pour éviter les doublons visuels.
- La petite icône ⇆ indique qu’il y a d’autres colonnes en faisant défiler.

### 9.2 Informations solaires

L’app affiche automatiquement :

- Les heures de lever et de coucher du soleil.
- Le crépuscule civil, marqué d’un « c ».
- La luminosité calculée selon l’heure et les conditions.

### 9.3 Sources de secours intelligentes

MeteoRide gère automatiquement :

- Le passage à Open-Meteo, **uniquement pour les étapes concernées**, si votre
  fournisseur dépasse son horizon, échoue à répétition ou n’a pas de données pour
  ce point.
- Les nouvelles tentatives en cas d’erreurs temporaires.
- Un bref avis dans l’en-tête quand cela se produit, si vous laissez les avis non
  critiques activés dans Réglages ([§7.2](#72-avis-non-critiques)).

Chaque requête a un délai : **15 secondes** pour que le serveur commence à
répondre et **15 secondes de plus** sans recevoir de données pendant le
téléchargement. Un fournisseur qui ne répond plus n’est pas de nouveau sollicité
pendant ce même calcul : les étapes restantes passent directement à la source de
secours au lieu d’attendre qu’il expire encore et encore.

### 9.4 URL avec paramètres

Vous pouvez ouvrir MeteoRide avec le parcours et les paramètres déjà réglés :

- `?gpx_url=https://example.com/route.gpx`
- `?datetime=2024-03-15T10:00`
- `?speed=25`

Ils peuvent se combiner. Le GPX est téléchargé par le navigateur directement
depuis cette URL : MeteoRide ne l’envoie nulle part.

### 9.5 Parcours récents

MeteoRide garde en local les derniers fichiers GPX que vous avez chargés pour que
vous puissiez les retrouver sans importer de nouveau le fichier.

- **Utilisation :** à côté du bouton 📁 se trouve une liste déroulante avec vos
  parcours récents. Choisissez-en un et il se charge exactement comme si vous
  veniez de l’importer.
- **Limite :** les **5** derniers parcours sont conservés. Recharger un parcours
  déjà enregistré le remonte en tête de liste au lieu de le dupliquer.
- **Taille recommandée :** jusqu’à environ **750 Ko** par GPX. Si le vôtre est
  bien plus gros, allégez-le ou hébergez-le et chargez-le avec `?gpx_url=`.
- **Confidentialité :** les fichiers GPX sont stockés dans votre navigateur avec
  IndexedDB (ou localStorage à défaut). Ils ne sont jamais partagés hors de votre
  appareil.
- **Efficacité :** seules les informations de base (nom, taille et date) sont
  gardées en mémoire ; le contenu complet n’est lu que quand vous choisissez le
  parcours.

### 9.6 Cache local et performances

Les réponses des fournisseurs sont stockées dans `localStorage` pendant environ
**30 minutes** par étape/heure. Cela accélère les rechargements fréquents et
réduit les requêtes vers les API à débit limité. Le cache expire de lui-même :
il n’y a rien à vider à la main.

---

## 10. Limites et conseils

### Limites

- **Horizon :** Open-Meteo 14 jours, OpenWeather 4 jours, AROME-HD 36 heures.
- **Précision :** les prévisions sont nettement moins fiables à partir du 3e ou
  4e jour.
- **Clés et limites :** Open-Meteo ne demande aucune clé et n’a pas de limite
  pratique ; les clés OpenWeather peuvent avoir des limites d’utilisation
  mensuelles.
- **MeteoRide ne modifie pas le parcours.** Il se contente de lire le GPX/KML.

### Bonnes pratiques

- Utilisez des parcours de 100 à 200 km au maximum pour de meilleures
  performances.
- Préparez-les 1 à 2 jours à l’avance pour plus de précision.
- Croisez les informations de plusieurs sources pour les décisions importantes.
- Ayez toujours un plan B en cas de mauvaises conditions.
- Emportez de quoi vous protéger de la pluie, même si la probabilité est faible.

---

## 11. Vigilances météo officielles

MeteoRide peut afficher les vigilances et alertes officielles émises par les
services météorologiques nationaux, quand elles figurent dans le tableau
`alerts` d’OpenWeather.

Pour les activer : saisissez votre **clé API OpenWeather** dans Réglages et
cochez **Afficher les vigilances météo officielles**.

- **Disponibilité :** demande une clé OpenWeather, puisque c’est le seul
  fournisseur qui les publie. Avec la clé configurée, MeteoRide vérifie les
  vigilances même quand OpenWeather n’est pas votre fournisseur principal. Sans
  clé, la case est désactivée et en indique la raison.
- **Visibilité :** quand une vigilance est détectée, une carte d’information
  apparaît et se masque d’elle-même au bout de 15 secondes. Un indicateur
  **⚠️** permanent reste dans l’interface pour que vous puissiez rouvrir toutes
  les vigilances détectées.
- **Échantillonnage et efficacité :** pour limiter les appels à l’API, un
  échantillon représentatif de points du parcours est vérifié (env. 2/3 des
  étapes, 3 au minimum). Les réponses de vigilance sont mises en cache en local
  pendant ~1 heure.
- **Fenêtre horaire :** seules sont prises en compte les vigilances dont la
  période (début/fin) chevauche la fenêtre horaire du tronçon correspondant, avec
  une tolérance de ±1 heure autour de l’étape.

> **Avertissement important.** Ces vigilances sont fournies à titre indicatif
> uniquement. Ne vous y fiez pas seules pour des décisions de sécurité.
> Consultez toujours le service météorologique officiel de votre pays ou les
> autorités compétentes avant d’entreprendre une activité qui pourrait être
> affectée par des conditions sévères. OpenWeather peut contenir des erreurs ou
> des retards, ou omettre certaines vigilances locales ; MeteoRide ne remplace
> pas les communications officielles.

---

## 12. Dépannage

| Symptôme | Ce qu’il faut vérifier |
|---|---|
| Le GPX/KML ne se charge pas | Vérifiez que le fichier contient des traces valides. |
| Pas de données météo | Vérifiez votre clé API avec 🔍 Vérifier, ou passez à Open-Meteo, qui n’en demande pas. |
| Date hors limites | Rapprochez la date : chaque fournisseur a son propre horizon ([§4](#4-fournisseurs-météo)). |
| Tableau vide | Assurez-vous que le parcours est assez long pour au moins une étape. |
| Un parcours partagé n’arrive pas dans l’app | Redémarrez le téléphone la première fois ([§6.2](#62-recevoir-un-parcours-depuis-une-autre-app)). |
| Les alertes de changement de météo n’arrivent pas | Lisez ce que l’app indique sous l’interrupteur ([§6.3](#63-alertes-quand-la-météo-change-sur-votre-parcours)). |

Pour signaler un problème, activez le bouton de débogage
([§7.5](#75-bouton-de-débogage)) et indiquez votre appareil et la version,
affichée en bas de la page d’aide.

---

## 13. Confidentialité et données

La politique elle-même — ce que reçoit chaque fournisseur, combien de temps il le
conserve, et comment supprimer tout ce qui reste sur l’appareil — est
[celle du site](https://app.meteoride.cc/privacy-web-fr.html),
[celle d’iOS](https://app.meteoride.cc/privacy-ios-fr.html) et
[celle d’Android](https://app.meteoride.cc/privacy-android-fr.html) — une par
plateforme, c’est ce qui est fourni au formulaire de chaque store, et les apps
sont plus fermées que le site. Cette section en est le résumé ; c’est la
politique qui doit être exacte.

**MeteoRide fonctionne entièrement sur votre appareil.** Tous les réglages,
préférences et données sont stockés uniquement sur votre appareil : dans le
navigateur (localStorage et IndexedDB) sur le site, et dans l’app aussi dans le
stockage propre du système, pour qu’iOS ne puisse pas effacer les réglages.

La seule exception est le site : si vous utilisez les Raccourcis iOS pour
partager un GPX, ce fichier est envoyé à Cloudflare. C’est inévitable, car les
Raccourcis iOS n’acceptent que le POST. Si vous ouvrez le fichier directement
depuis MeteoRide, rien n’est envoyé, car il est traité en local, et l’app native
n’en a pas du tout besoin. Dans tous les cas, le GPX envoyé est supprimé
automatiquement en deux minutes au plus.

- **Aucun compte :** vous n’avez pas besoin de créer un compte ni de fournir de
  données personnelles.
- **Contrôle total :** sur le site, effacez les données du site dans les
  réglages de votre navigateur ; dans l’app, désinstallez-la (iPhone) ou effacez
  son stockage (Android). La politique de votre plateforme explique ce qu’il
  advient des sauvegardes.
- **Code ouvert :** vous pouvez consulter tout le code source sur GitHub.

### Données partagées avec les fournisseurs météo

Pour obtenir les prévisions, MeteoRide partage uniquement :

- Les **coordonnées géographiques** des points de votre parcours.
- Les **dates et heures** pour lesquelles vous avez besoin des prévisions.
- **Votre clé API**, si vous utilisez OpenWeather.

Les fournisseurs météo (Open-Meteo, OpenWeather) ont leurs propres politiques de
confidentialité. MeteoRide agit seulement comme un client qui demande les
données de prévision dont vous avez besoin.

### À propos de la clé API

La clé est stockée dans le stockage local de votre appareil, **sans
chiffrement**. Elle pourrait donc, en théorie, être lue par un tiers ayant accès
à votre appareil, ou par un autre script exécuté dans votre navigateur. Le risque
avec ce type de clé est faible, mais il est recommandé d’utiliser une clé dédiée
avec des permissions minimales. Vous pouvez aussi vous passer complètement de
clé et utiliser les fournisseurs qui n’en demandent pas (Open-Meteo, AROME-HD).

### Ce qui est stocké localement

- Les réglages d’unités et de langue.
- Les clés API, sans chiffrement.
- Les préférences de vitesse et d’intervalle.
- Un cache temporaire des données météo (~30 minutes).
- Les 5 derniers parcours GPX chargés.
- Dans l’app native, aussi les tuiles de carte que vous avez consultées, chacune
  jusqu’à l’expiration fixée par son serveur.

Si vous avez besoin de garanties de confidentialité plus strictes, vous pouvez
faire tourner MeteoRide entièrement en local (en ouvrant `index.html` sans
utiliser les fonctions de partage ou d’envoi) ou déployer votre propre
share-server avec les règles d’accès que vous décidez ([DEPLOY.md](DEPLOY.md)).

---

## 14. Licence et crédits

Développé par [Lockevod](https://github.com/lockevod).

### Licence

Ce projet est sous **licence MIT**, ce qui signifie que :

- Vous pouvez utiliser l’application librement.
- Vous pouvez modifier le code source.
- Vous pouvez distribuer votre propre version.
- Pour un usage personnel et commercial.
- Vous devez mentionner l’auteur et la licence MIT.

### Technologies et services

- **Cartes :** OpenStreetMap et ses contributeurs.
- **Données météo :** Open-Meteo, OpenWeather.
- **Icônes météo :** Weather Icons d’Erik Flowers.
- **Bibliothèques :** Leaflet.js, SunCalc, GPX parser.
- **App native :** Capacitor (iOS / Android).
- **Hébergement :** Cloudflare Pages (version web uniquement).
- **Scripts :** Tampermonkey.

### Marques et responsabilité

Bikemap, Komoot, OpenWeatherMaps, Openmeteo et Hammerhead sont des marques
déposées. Elles peuvent avoir des licences propriétaires spécifiques ; si vous
utilisez ce code ou la webapp publiée, vous devez les respecter.

Ce code et la webapp sont conçus avec une sécurité de type « zero trust » en
tête, mais ce ne sont ni un code commercial ni un service commercial. Le code et
la webapp sont fournis tels quels, sans aucune garantie ni responsabilité. Vous
l’acceptez si vous téléchargez ce dépôt, utilisez le code ou utilisez la webapp.

Les informations à jour sur cette app se trouvent toujours sur
[GitHub](https://github.com/lockevod/MeteoRide). Vous acceptez toutes les
informations, responsabilités et restrictions à jour de cette page si vous
utilisez cette app.

### Avertissement

MeteoRide est un outil de préparation. Les données météo sont des estimations et
peuvent ne pas être tout à fait exactes. Faites toujours preuve de bon sens et
vérifiez les conditions avant de partir. Le développeur n’est pas responsable
des décisions prises sur la base de ces informations.

---

## 15. Assistance et contributions

### Signaler un problème

- Ouvrez une issue dans le
  [dépôt GitHub](https://github.com/lockevod/MeteoRide/issues).
- Activez le bouton de débogage (🐞) dans **Réglages → Afficher le bouton de
  débogage** : il est désactivé au départ.
- Indiquez votre appareil et la version, affichée en bas de la page d’aide.

### Contribuer

- Forkez le dépôt sur GitHub.
- Signalez des bugs ou proposez des améliorations.
- Traduisez dans de nouvelles langues.
- Améliorez la documentation.

La météo peut changer vite. Servez-vous de MeteoRide comme d’un guide, mais
restez flexible et prudent pendant vos sorties.
