# Guía de usuario de MeteoRide

La ayuda que llevas dentro de la app responde a «qué hago». Esta guía responde a
«por qué» y «qué pasa si». Aquí está el detalle completo: los límites de cada
proveedor, lo que la app guarda y dónde, cómo se comporta sin cobertura y todas
las recetas de instalación.

English version: [GUIDE.md](GUIDE.md) · Ayuda de la app:
[help.html](https://app.meteoride.cc/help.html)

---

## 1. Qué es MeteoRide

MeteoRide es una aplicación para ciclistas —en la web y como app de iPhone y
Android— que carga rutas GPX/KML y muestra el pronóstico a lo largo del
recorrido.

La app calcula los pasos de la ruta a partir de la velocidad de ciclismo que
elijas y pide a uno o varios proveedores meteorológicos la temperatura, el
viento, la precipitación, la humedad, la nubosidad, la luminosidad y el índice
UV para cada uno de esos pasos. Incluye fallbacks automáticos para asegurar
datos aunque un proveedor falle, y permite comparar pronósticos de distintas
fuentes o de dos fechas distintas.

MeteoRide no edita la ruta: solo la lee.

---

## 2. Primeros pasos

### 2.1 Cargar una ruta GPX/KML

Pulsa el botón **📁** y elige tu archivo. Se admiten tracks, rutas y waypoints
estándar de GPX y KML.

También puedes cargar una ruta desde un enlace con los parámetros descritos en
[§9.4](#94-urls-con-parámetros), o compartirla desde otra app si usas la app
nativa ([§6](#6-en-la-app-de-iphone-y-android)).

### 2.2 Fecha y hora

Selecciona cuándo planeas hacer la ruta. El sistema ajusta automáticamente la
hora a intervalos de 15 minutos.

### 2.3 Velocidad

Introduce tu velocidad media estimada o usa uno de los presets: 5, 10, 12, 15 o
20 km/h. De esa velocidad sale la hora a la que estarás en cada punto, así que
es lo que más cambia el resultado.

### 2.4 Intervalo

Elige cada cuántos minutos quieres ver información meteorológica: 15 o 30
minutos.

### 2.5 Proveedor

Elige el proveedor o la cadena de proveedores que quieres usar. Están descritos
en [§4](#4-proveedores-meteorológicos). Qué ocurre si el que elegiste falla está
en [§9.3](#93-fallbacks-inteligentes).

### 2.6 Modo Comparar proveedores (Comp.)

Activa la casilla **Comp.** para evaluar las diferencias entre proveedores sobre
la misma ruta y la misma hora.

- Lee Open-Meteo y AROME exactamente igual que la tabla normal, incluidos los
  datos de cuarto de hora dentro de las primeras 5 horas.
- Si un proveedor no responde, el aviso dice cuál ha fallado en vez de un error
  genérico.

### 2.7 Modo Comparar fechas

Compara el pronóstico de la misma ruta en dos fechas u horas distintas.

- Selecciona **Comparar Fechas** en el desplegable de proveedores para entrar en
  este modo.
- Configura Fecha A y Fecha B con los controles de fecha/hora que aparecen. Los
  botones de solo iconos despliegan la segunda fecha.
- Pulsa **🔄 Comparar** para actualizar la tabla.
- La tabla muestra 4 filas: intervalos de Fecha A, resumen de Fecha A,
  intervalos de Fecha B, resumen de Fecha B.
- **No hay recálculo automático.** Si cambias cualquier parámetro tienes que
  volver a pulsar Comparar.

---

## 3. Cargar rutas desde otras webs (userscripts)

El proyecto incluye dos userscripts opcionales de Tampermonkey. No hacen falta
para usar MeteoRide; son atajos para quien planifica en otras webs. Las
instrucciones de instalación están en
[USERSCRIPTS.md](USERSCRIPTS.md).

- **Komoot / Bikemap / Hammerhead → MeteoRide**: añade un botón que abre la ruta
  que estás viendo directamente en MeteoRide. En Komoot la descarga de GPX solo
  está disponible con una cuenta **Premium**; sin ella el script no puede
  obtener el fichero.
- **MeteoRide → Hammerhead**: añade un botón en MeteoRide que exporta el GPX
  actual a Hammerhead (dashboard.hammerhead.io). El script sube el GPX en bruto
  a un share-server que tú configuras y pide a Hammerhead que importe esa URL.

---

## 4. Proveedores meteorológicos

| Proveedor | Clave API | Horizonte | Cobertura |
|---|---|---|---|
| Open-Meteo | No | 14 días | Global |
| OpenWeather | Sí (gratuita) | 4 días | Global |
| AROME-HD | No | 36 horas | Parte de Europa |

- **Open-Meteo**: gratuito, sin clave, cobertura global, hasta 14 días.
  Open-Meteo elige su mejor modelo según la zona de tu track. Recomendado para
  cualquier escenario, e ideal para planificación a largo plazo y rutas fuera de
  Europa.
- **OpenWeather**: requiere clave API, hasta 4 días. Excelentes datos en tiempo
  real, y es **el único proveedor que publica alertas meteorológicas oficiales**
  ([§11](#11-alertas-meteorológicas-oficiales)). Ideal para salidas inmediatas y
  áreas urbanas.
- **AROME-HD**: modelo de alta resolución (~1-2 km) de MeteoFrance, accesible a
  través de Open-Meteo y sin clave. Solo disponible para Europa
  (aprox. 39-52°N, 10.5°O-16.5°E) y dentro de 36 horas. Fuera de esa zona o de
  ese plazo conmuta directamente al mejor modelo que Open-Meteo tenga para esa
  localización, sin avisar de nada raro: sigue habiendo datos. Superior para
  viento y precipitación a corto plazo en Francia y países cercanos.

### Cadenas de proveedores

Las cadenas combinan las fortalezas de varios proveedores dentro de la misma
tabla:

- **OpenWeather → AROME-HD → Open-Meteo**: datos en tiempo real de OpenWeather
  para la primera hora, precisión hiperlocal de AROME para las 47 horas
  siguientes, y Open-Meteo para el resto del pronóstico. Requiere clave de
  OpenWeather; sin ella la opción aparece deshabilitada en el selector.

Elige según lo que necesites: precisión en tiempo real (OpenWeather), precisión
local (AROME-HD) o planificación a largo plazo (Open-Meteo).

---

## 5. Instalar como app web (PWA)

La web de MeteoRide se puede instalar como Aplicación Web Progresiva (PWA) para
una experiencia parecida a la de una app nativa. Necesitas la web desplegada en
un servidor o usar <https://app.meteoride.cc>.

Si lo que quieres es la app nativa de iPhone o Android, no necesitas nada de
esto: instálala desde la tienda.

Estos mismos pasos, y las otras formas de tener MeteoRide, están también en
[`docs/INSTALL.md`](INSTALL.md) (en inglés).

**Android**

1. Abre MeteoRide en Chrome.
2. Toca el menú (tres puntos) en la parte superior derecha.
3. Selecciona «Agregar a pantalla de inicio».
4. Confirma tocando «Agregar».

**iOS (iPhone/iPad)**

1. Abre MeteoRide en Safari.
2. Toca el botón Compartir (cuadrado con flecha).
3. Selecciona «Agregar a pantalla de inicio».
4. Toca «Agregar» en la parte superior derecha.

**Chrome en escritorio**

1. Abre MeteoRide en Chrome.
2. Haz clic en el icono de instalar de la barra de direcciones o en el menú.
3. Haz clic en «Instalar».

**Edge en escritorio**

1. Abre MeteoRide en Edge.
2. Haz clic en el icono de instalar de la barra de direcciones.
3. Haz clic en «Instalar».

**Safari en Mac**

1. Abre MeteoRide en Safari.
2. Ve a Archivo > Agregar al Dock.
3. O haz clic en el botón Compartir y selecciona «Agregar al Dock».

---

## 6. En la app de iPhone y Android

Esto solo existe dentro de la app nativa: son cosas que un navegador no puede
hacer.

### 6.1 Enviar la ruta a otra app

Con una ruta cargada, el botón **📤** de la barra superior abre la hoja de
compartir del sistema con el GPX adjunto. Desde ahí va a tu ciclocomputador
(Hammerhead, Wahoo), a Archivos, al correo o a donde quieras. El fichero no sale
del dispositivo en ningún momento: no hay servidor intermedio, a diferencia del
atajo de iOS que necesita la web.

### 6.2 Recibir una ruta desde otra app

Al revés también: en Komoot, Strava, Bikemap, Archivos o el correo, comparte el
GPX y elige **MeteoRide**. La app se abre con la ruta ya cargada. Igual con
«Abrir en MeteoRide» desde un fichero descargado.

Si MeteoRide no aparece en la hoja de compartir la primera vez, reinicia el
teléfono: el sistema tarda un poco en registrar la app como destino.

### 6.3 Avisos si cambia el tiempo de tu ruta

Un pronóstico es una previsión hecha con horas de antelación. Cuando calculas
una ruta, la app se queda vigilándola y te avisa si empeora para las horas en
que vas a estar fuera:

- Estaba seco y va a llover, o la lluvia pasa a ser fuerte.
- Había calma y va a hacer viento moderado o fuerte, o rachas a partir de
  unos 43 km/h.
- Se emite un aviso oficial que solapa tu salida. Esto necesita clave de
  OpenWeather y tener activadas las alertas oficiales.

Cada cambio se avisa una sola vez; si luego empeora más, vuelve a avisar. Las
mejoras no se avisan, y los tramos que ya has pasado tampoco. La vigilancia
termina una hora después del último punto de la ruta.

Se activa y desactiva en **Configuración → Alertas → «Avisarme si cambia el
tiempo de la ruta»**, activado por defecto, y debajo del interruptor la app te
dice qué ruta está vigilando y hasta cuándo.

**Importante:** la comprobación la ejecuta el sistema operativo cuando quiere,
no la app. En iPhone hace falta tener activada la *Actualización en segundo
plano* para MeteoRide (Ajustes → General), y el modo de bajo consumo la
suspende. En Android, algunos fabricantes matan las tareas de fondo con su
gestor de batería. Si el sistema no la va a ejecutar, la propia app te lo dice
debajo del interruptor en vez de dejarte creer que estás vigilado.

### 6.4 Sin cobertura

El tiempo no se puede inventar, pero lo ya descargado no se tira:

- Al abrir la app vuelve la última ruta con su tabla, sin tener que cargar nada.
- Si el pronóstico es antiguo se sigue mostrando, indicando cuántas horas tiene.
  Deja de hacerlo a las doce horas.
- Las teselas del mapa que ya has mirado se guardan en el teléfono y vuelven a
  salir sin conexión. En una zona que no hayas abierto antes el fondo sale en
  blanco y el mapa lo indica.
- Si no hay datos, lo dice: no se queda una pantalla vacía sin explicación.

El botón **📴** guarda el pronóstico de la ruta que tengas cargada y lo protege
del borrado automático de la caché. Púlsalo en casa antes de salir.

### 6.5 Mapa y ajustes

- Sin ruta cargada, el mapa se abre donde estás en lugar de en Barcelona.
- La app arranca en el idioma del teléfono mientras no elijas uno a mano.
- Las unidades, el idioma, tu clave de API, las rutas recientes y las teselas que
  ya has mirado se guardan fuera del navegador interno, de una forma que WebKit
  sí conserva: no se pierden si el sistema libera espacio y en iPhone siguen ahí
  al volver a abrir la app. Antes no.
- La primera vez que el mapa te busca, el sistema pide el permiso de ubicación
  en nombre de MeteoRide.
- El teléfono se queda en vertical, porque al girarlo se rompe la pantalla. El
  iPad sí gira.

---

## 7. Configuración

### 7.1 Claves API

Solo OpenWeather necesita clave, y solo si quieres usar ese proveedor o las
alertas oficiales. Se obtiene gratis en
[openweathermap.org/api](https://openweathermap.org/api) (One Call API).

Junto al campo hay un botón **🔍 Check**: la app hace una petición simple y
muestra el estado al lado (válida / inválida / cuota / código HTTP). Úsalo antes
de salir de casa si acabas de crear la clave; OpenWeather tarda un rato en
activarlas.

### 7.2 Avisos no críticos

La casilla **Mostrar avisos no críticos** controla la verbosidad de las
notificaciones. Activada, verás banners informativos cuando se produzcan
fallbacks por horizonte temporal, cuota o errores de API. Desactivada, solo se
muestran los errores críticos.

### 7.3 Unidades

- **Viento:** km/h, m/s, mph
- **Temperatura:** °C, °F
- **Distancia:** km, mi
- **Precipitación:** mm, in

### 7.4 Idiomas

La aplicación soporta español e inglés. El idioma elegido cambia la interfaz y
los mensajes. En la app nativa, mientras no elijas uno a mano se usa el del
teléfono.

### 7.5 Botón de debug

**Configuración → Mostrar botón de debug** enciende el botón 🐞. Viene apagado.
Sirve para adjuntar información al reportar un problema.

---

## 8. Interpretar los datos

### 8.1 La tabla meteorológica

La tabla muestra información hora por hora:

- **Primera fila:** hora y distancia acumulada.
- **Segunda fila:** iconos del tiempo, con indicadores de cambio de proveedor
  cuando corresponda.
- **Temperatura:** en grados Celsius o Fahrenheit.
- **Viento:** velocidad + flecha de dirección; las rachas entre paréntesis.
- **Lluvia:** cantidad en mm/h **de la hora que vas a pedalear** (probabilidad
  entre paréntesis). No es la lectura más cercana al minuto exacto del paso,
  sino la de la hora completa que estarás recorriendo ese tramo.
- **Humedad:** porcentaje de humedad relativa.
- **Nubosidad:** porcentaje de cobertura de nubes.
- **Luminosidad:** barra vertical junto al símbolo del tiempo, en la segunda
  fila. Representa 0-100% de luz disponible para ese intervalo.
- **UV:** índice ultravioleta (número entero), en la fila combinada «Nubes / UV».

### 8.2 Indicadores de cambio de proveedor

Cuando la fuente de datos cambia durante la ruta verás una etiqueta abreviada
sobre los datos de esa columna:

- **OPM** — Open-Meteo
- **ARM** — AROME-HD
- **OPW** — OpenWeather

Aparecen en modo normal, en comparar proveedores y en comparar fechas, y marcan
exactamente qué proveedor suministra los datos en cada segmento temporal. Son
especialmente útiles con las cadenas, donde se combinan varias fuentes.

### 8.3 El mapa

- **Flechas azules:** viento suave (<12 km/h)
- **Flechas rojas:** viento fuerte (30-50 km/h)
- **Flechas moradas:** viento muy fuerte (>50 km/h)
- **Gotas 💧:** precipitación esperada
- **Marcadores verdes/rojos:** inicio y final de la ruta

---

## 9. Funciones avanzadas

### 9.1 Desplazamiento horizontal de la tabla

La tabla es interactiva y está adaptada a pantallas táctiles:

- Arrastra horizontalmente la tabla o usa la rueda del ratón para desplazar
  columnas (gestos y *drag-to-scroll*).
- Haz clic en cualquier columna —o en cualquier celda, para seleccionar esa
  columna— y se resaltarán la fila y el mapa.
- El mapa se centra en el punto seleccionado si haces clic en una flecha de
  viento o en la columna.
- Si la penúltima columna queda a menos de 5 minutos de la última, la app la
  oculta para evitar duplicados visuales.
- El pequeño icono ⇆ indica que hay más columnas disponibles al desplazarte.

### 9.2 Información solar

La app muestra automáticamente:

- Hora de amanecer y atardecer.
- Crepúsculo civil, marcado con «c».
- Cálculo de luminosidad real según la hora y las condiciones.

### 9.3 Fallbacks inteligentes

MeteoRide maneja automáticamente:

- El cambio a Open-Meteo, **solo para los pasos afectados**, si tu proveedor
  excede su horizonte temporal, falla repetidamente o no tiene datos para ese
  punto.
- Reintentos cuando hay errores temporales.
- Un aviso breve en la cabecera cuando eso ocurre, si dejas activados los avisos
  no críticos en Configuración ([§7.2](#72-avisos-no-críticos)).

Cada petición tiene un plazo: **15 segundos** para que el servidor empiece a
responder y **15 segundos más** sin recibir datos mientras descarga. Si un
proveedor se queda callado, no se le vuelve a preguntar durante ese mismo
cálculo: los pasos restantes se piden directamente al fallback en vez de
esperar a que agote el plazo una y otra vez.

### 9.4 URLs con parámetros

Puedes abrir MeteoRide con la ruta y los parámetros ya puestos:

- `?gpx_url=https://ejemplo.com/ruta.gpx`
- `?datetime=2024-03-15T10:00`
- `?speed=25`

Se pueden combinar. El GPX se descarga desde el navegador directamente de esa
URL: MeteoRide no lo sube a ningún sitio.

### 9.5 Rutas recientes

MeteoRide guarda localmente las últimas rutas GPX que has cargado para que
puedas recuperarlas sin subir de nuevo el archivo.

- **Cómo usarlo:** junto al botón 📁 hay un desplegable con tus rutas recientes.
  Selecciona una y se cargará exactamente como si la hubieras subido ahora.
- **Límite:** se guardan las últimas **5** rutas. Si vuelves a cargar una ruta
  que ya estaba guardada, sube al principio de la lista en vez de duplicarse.
- **Tamaño recomendado:** hasta unos **750 KB** por GPX. Si el tuyo es bastante
  mayor, recórtalo o alójalo y cárgalo con `?gpx_url=`.
- **Privacidad:** los GPX se almacenan en tu navegador con IndexedDB (o
  localStorage como fallback). No se comparten fuera de tu dispositivo.
- **Eficiencia:** en memoria solo se mantiene la información básica (nombre,
  tamaño y fecha); el contenido completo se lee solo cuando seleccionas la ruta.

### 9.6 Caché local y rendimiento

Las respuestas de los proveedores se almacenan en `localStorage` durante unos
**30 minutos** por paso/hora. Esto acelera las recargas frecuentes y reduce las
peticiones a APIs con límites de uso. Caduca sola: no hay nada que borrar a
mano.

---

## 10. Limitaciones y consejos

### Limitaciones

- **Horizonte temporal:** Open-Meteo 14 días, OpenWeather 4 días, AROME-HD
  36 horas.
- **Precisión:** las previsiones son notablemente menos fiables a partir del
  día 3-4.
- **APIs gratuitas:** Open-Meteo no requiere clave ni tiene límite práctico;
  OpenWeather ofrece una modalidad gratuita, pero las claves pueden tener
  límites de uso mensuales.
- **MeteoRide no edita la ruta.** Solo lee el GPX/KML.

### Mejores prácticas

- Usa rutas de máximo 100-200 km para mejor rendimiento.
- Planifica con 1-2 días de antelación para mayor precisión.
- Combina información de varias fuentes para decisiones importantes.
- Ten siempre un plan B para condiciones adversas.
- Lleva equipo de lluvia aunque la probabilidad sea baja.

---

## 11. Alertas meteorológicas oficiales

MeteoRide puede mostrar los avisos y alertas oficiales que publican los
servicios meteorológicos nacionales, cuando aparecen en el array `alerts` de
OpenWeather.

Para activarlas: introduce tu **OpenWeather API Key** en Configuración y activa
la casilla **Mostrar alertas meteorológicas oficiales**.

- **Disponibilidad:** requiere clave de OpenWeather, porque es el único
  proveedor que las publica. Con la clave configurada, MeteoRide comprueba
  alertas aunque no hayas seleccionado OpenWeather como proveedor principal. Sin
  clave, la casilla aparece deshabilitada y explica por qué.
- **Visibilidad:** cuando se detecta una alerta aparece una tarjeta informativa
  que se auto-oculta a los 15 segundos. Queda además un indicador persistente
  **⚠️** que permite reabrir todas las alertas detectadas.
- **Muestreo y eficiencia:** para reducir las llamadas a la API se comprueba una
  muestra representativa de puntos a lo largo de la ruta (aprox. 2/3 de los
  pasos, mínimo 3). Las respuestas se cachean localmente durante ~1 hora.
- **Compatibilidad temporal:** solo se consideran las alertas cuyo periodo
  (start/end) coincide con la ventana temporal del tramo correspondiente de la
  ruta, con una tolerancia de ±1 hora alrededor del paso.

> **Aviso importante.** Estas alertas se proporcionan solo como información
> adicional. No confíes exclusivamente en ellas para decisiones de seguridad.
> Consulta siempre el servicio meteorológico oficial de tu país o las
> autoridades competentes antes de realizar una actividad que pueda verse
> afectada por condiciones adversas. OpenWeather puede contener errores,
> retrasos o no incluir avisos locales específicos; MeteoRide no sustituye a los
> comunicados oficiales.

---

## 12. Resolución de problemas

| Síntoma | Qué mirar |
|---|---|
| El GPX/KML no carga | Verifica que el archivo contenga tracks válidos. |
| Sin datos meteorológicos | Comprueba tu clave API con 🔍 Check, o cambia a Open-Meteo, que no necesita clave. |
| Fecha fuera de rango | Reduce el horizonte temporal: cada proveedor tiene el suyo ([§4](#4-proveedores-meteorológicos)). |
| Tabla vacía | Asegúrate de que la ruta tiene longitud suficiente para al menos un paso. |
| La ruta compartida no llega a la app | Reinicia el teléfono la primera vez ([§6.2](#62-recibir-una-ruta-desde-otra-app)). |
| No llegan los avisos de cambio de tiempo | Mira lo que dice la app debajo del interruptor ([§6.3](#63-avisos-si-cambia-el-tiempo-de-tu-ruta)). |

Para reportar un problema, enciende el botón de debug
([§7.5](#75-botón-de-debug)) e incluye tu dispositivo y la versión, que aparece
al final de la página de ayuda.

---

## 13. Privacidad y datos

La política en sí — qué recibe cada proveedor, cuánto lo conserva y cómo borrar todo
lo que queda en el dispositivo — está en
[la de la web](https://app.meteoride.cc/privacy-web.html),
[la de iOS](https://app.meteoride.cc/privacy-ios.html) y
[la de Android](https://app.meteoride.cc/privacy-android.html) — una por plataforma, que
es lo que se da a cada tienda, y las apps son más cerradas que la web. Esta
sección es el resumen; la que tiene que estar bien es la política.

**MeteoRide funciona completamente en tu dispositivo.** Toda la configuración,
las preferencias y los datos se almacenan únicamente en tu navegador, mediante
localStorage e IndexedDB.

La única excepción es la web: si usas los atajos de iOS para compartir un GPX,
ese fichero se envía a Cloudflare. Es imprescindible porque los atajos de iOS
solo aceptan POST. Si abres el fichero directamente desde MeteoRide no se envía
nada, porque se procesa en local, y la app nativa no lo necesita en absoluto. En
cualquier caso el GPX subido se borra automáticamente en un plazo máximo de dos
minutos.

- **Sin registro:** no necesitas crear cuenta ni proporcionar datos personales.
- **Control total:** puedes borrar todos los datos desde la configuración de tu
  navegador.
- **Código abierto:** puedes inspeccionar todo el código fuente en GitHub.

### Datos compartidos con los proveedores meteorológicos

Para obtener las predicciones, MeteoRide comparte únicamente:

- Las **coordenadas geográficas** de los puntos de tu ruta.
- Las **fechas y horas** para las que necesitas la previsión.
- **Tu API Key**, si usas OpenWeather.

Los proveedores meteorológicos (Open-Meteo, OpenWeather) tienen sus propias
políticas de privacidad. MeteoRide solo actúa como intermediario para solicitar
los datos que necesitas.

### Sobre la clave API

La clave se guarda en el almacenamiento local de tu equipo, **sin cifrar**. Eso
significa que podría ser accesible, hipotéticamente, por un tercero con acceso a
tu dispositivo o a otro script ejecutándose en tu navegador. El riesgo con este
tipo de claves es bajo, pero se recomienda usar una clave gratuita con permisos
mínimos. Alternativamente, puedes no usar claves y confiar en los proveedores
que no las requieren (Open-Meteo, AROME-HD).

### Qué se guarda localmente

- Configuración de unidades e idioma.
- Claves API, sin cifrar.
- Preferencias de velocidad e intervalos.
- Caché temporal de datos meteorológicos (~30 minutos).
- Las últimas 5 rutas GPX cargadas.
- En la app nativa, además, las teselas del mapa que ya has mirado.

Si necesitas garantías de privacidad más estrictas, puedes ejecutar MeteoRide
completamente en local (abriendo `index.html` sin usar las funciones de
compartir/subir) o desplegar tu propio share-server con las políticas de acceso
que decidas ([DEPLOY.md](DEPLOY.md)).

---

## 14. Licencia y créditos

Desarrollado por [Lockevod](https://github.com/lockevod).

### Licencia

Este proyecto está licenciado bajo la **Licencia MIT**, lo que significa que:

- Puedes usar la aplicación libremente.
- Puedes modificar el código fuente.
- Puedes distribuir tu propia versión.
- Para uso personal y comercial.
- Tienes que informar sobre el autor y la licencia MIT.

### Tecnologías y servicios

- **Mapas:** OpenStreetMap y sus colaboradores.
- **Datos meteorológicos:** Open-Meteo, OpenWeather.
- **Iconos meteorológicos:** Weather Icons de Erik Flowers.
- **Librerías:** Leaflet.js, SunCalc, GPX parser.
- **App nativa:** Capacitor (iOS / Android).
- **Alojamiento:** Cloudflare Pages (solo la versión web).
- **Scripts:** Tampermonkey.

### Marcas y responsabilidad

Bikemap, Komoot, OpenWeatherMaps, Openmeteo y Hammerhead son marcas
registradas. Pueden tener licencias propietarias específicas; por favor, si usas
este código o la aplicación web publicada debes cumplir con ellas.

Este código y la aplicación web están diseñados con la seguridad de tipo «zero
trust» en mente, pero no son un código ni un servicio comercial. El código y la
aplicación web se proporcionan tal cual, sin ninguna garantía ni
responsabilidad. Aceptas esto si descargas este repositorio, usas el código o
usas la aplicación web.

La información actualizada sobre esta aplicación está siempre en
[GitHub](https://github.com/lockevod/MeteoRide). Aceptas toda la información
actualizada, responsabilidades y restricciones de esa página si usas esta
aplicación.

### Exención de responsabilidad

MeteoRide es una herramienta de planificación. Los datos meteorológicos son
estimaciones y pueden no ser completamente precisos. Siempre usa tu criterio y
verifica las condiciones antes de salir. El desarrollador no se hace responsable
de decisiones basadas en esta información.

---

## 15. Soporte y contribuciones

### Reportar problemas

- Abre una incidencia en el
  [repositorio en GitHub](https://github.com/lockevod/MeteoRide/issues).
- Activa el botón de debug (🐞) en **Configuración → Mostrar botón de debug**:
  viene apagado.
- Incluye tu dispositivo y la versión, que aparece al final de la página de
  ayuda.

### Contribuir

- Haz un fork del repositorio en GitHub.
- Reporta bugs o sugiere mejoras.
- Traduce a nuevos idiomas.
- Mejora la documentación.

El tiempo puede cambiar rápidamente. Usa MeteoRide como guía, pero mantente
flexible y seguro en tus rutas.
