# Atajo iOS para abrir un GPX en la PWA (sin “Obtener contenido del archivo”)

URL de tu PWA (ejemplo de la webapp publicada por lockevod): https://app.meteoride.cc/  
Sustituye PWA_URL en los pasos por tu URL real.


## Atajo A — Abrir por enlace directo (gpx_url)

Objetivo: Abrir una URL que ya apunta a un .gpx (el servidor debe permitir CORS).

1) Preguntar la URL del GPX
- Acción: “Preguntar” (Texto) → “Pega la URL del GPX”
- Renombra la salida a “GPX_URL”.

2) Preguntar el nombre (opcional)
- Acción: “Preguntar” (Texto) → “Nombre de la ruta (opcional)”
- Si queda vacío, usa “Ruta compartida”.

3) Codificar el nombre para URL
- Acción: “Codificar URL” sobre el nombre → resultado “NombreURL”.

4) Construir y abrir
- Acción: “Texto”
```
PWA_URL#gpx_url=GPX_URL&name=NombreURL
```
- Acción: “Abrir URL”

## Atajo B — Sin Base64, inyectando el GPX por JavaScript (100% fiable)
Usa el puente postMessage que trae la web. No hay límites de longitud en la URL ni problemas de tipos.

Pasos detallados para configurar el Atajo en la app Atajos de iOS:

1) Recibir entrada del atajo (Archivos .gpx)
   - Acción: “Recibir entrada del atajo” → Tipo: Archivos
   - Asegúrate de que el tipo sea “Archivos” (no “Texto”).

2) Obtener archivos de la entrada
   - Acción: “Obtener archivos de la entrada” (si hay múltiples, añade “Obtener elemento de la lista” → Índice 1 para seleccionar el primero).

3) Codifica en Base 64 el archivo (entrada atajo. Comprueba que está marcado como archivo no como texto)
   - Acción: “Codificar (Base64)” → Entrada: Selecciona la salida del paso anterior (debe aparecer como “Archivo”).
   - Si aparece como “Nombre”, revisa los pasos anteriores para forzar que sea archivo (ver sección “Si ‘Codificar (Base64)’ coge el Nombre y no el Archivo”).

4) (Si varios) Obtener elemento de la lista → Índice 1
   - Solo si hay múltiples archivos.

5) Abrir URL
   - Acción: “Abrir URL” → URL: `https://app.meteoride.cc/`
   - Opciones: Abrir en Safari (desactiva “Vista rápida” si está disponible).

6) Esperar
   - Acción: “Esperar” → 0.7–1.0 segundos (para que la página cargue).

7) Ejecutar JavaScript en página web
   - Acción: “Ejecutar JavaScript en página web” → Página: Safari
   - Código: Pega el siguiente código JavaScript. Para insertar variables (como el nombre del archivo y el Base64), toca las píldoras azules en la barra de herramientas del editor de código y selecciona las salidas de los pasos anteriores (e.g., “Nombre del archivo” para `name` y “Base64” para `b64`).
   ```js
   /* Pega aquí variables del Atajo: */
   const name = /* (Nombre del archivo) */ 
   const b64 = (variable Base64);
   const gpx = atob(b64); */;

   // Debugging: Add these lines to check if data is correct
   console.log('GPX name:', name);
   console.log('GPX data length:', gpx.length);
   console.log('GPX data preview:', gpx.substring(0, 200));  // First 200 chars

   window.postMessage({ type: "cw-gpx", name, gpx }, "*");
   console.log('PostMessage sent for GPX loading');
   completion();
   ```
   - **Nota**: En el editor de JavaScript, asegúrate de que las variables se inserten correctamente usando las píldoras. Si no aparecen, verifica que los pasos anteriores produzcan salidas válidas.

Notas
- Si no puedes obtener el GPX como texto en Atajos, puedes:
  - Codificar (Base64) el Archivo y en el JS decodificar: const gpx = atob(/*Base64*/);
- La app ya escucha postMessage y cargará el GPX.
- **Debugging tips**: If the GPX doesn't load, modify the URL in step 4 to include the log parameter. Change `https://app.meteoride.cc/` to `https://app.meteoride.cc/?log=1` (for query string) or `https://app.meteoride.cc/#log=1` (for hash, if the app uses hash parameters). Then, open Safari's console (enable Developer mode in Settings > Safari > Advanced > Web Inspector, then connect to a Mac with Safari for full console access). Look for logs like "Decoded GPX OK" or errors like "[cw] GPX error". The console.log statements above will show the name, data length, and preview. If the data length is small (~50-100), the Base64 might be truncated—check the "Codificar (Base64)" step.

Diagnóstico rápido
- Si ves en consola “[cw] GPX error: No parseable layers…”, el texto recibido no trae <trk>/<rte>/<wpt> (está truncado). Revisa que el paso “Codificar (Base64)” use el Archivo y no el Nombre, o usa el Atajo C.


## Consejos y alternativas
- Si en tu iOS “Codificar” no acepta archivos, prueba a poner justo antes “Obtener detalles de archivos” → “Tamaño” (esto fuerza a tratar la entrada como datos) y vuelve a “Codificar (Base64)”. En iOS 16/17 la acción “Codificar” suele aceptar directamente “Entrada del atajo (Archivo)”.
- Si la URL final es muy larga y Safari no la abre, usa el Atajo B (gpx_url) o comparte GPX más pequeños.
- La PWA también acepta parámetros en query en lugar de hash: ?gpx= o ?gpx_url=.

Pruebas rápidas
- Inline GPX mínimo (URL‑encoded):
```
https://tusitio/#name=Test&gpx=%3Cgpx%20version%3D%221.1%22%3E...%3C%2Fgpx%3E
```
- Enlace remoto:
```
https://tusitio/#name=Morning&gpx_url=https://ejemplo.com/route.gpx
```


## Si “Codificar (Base64)” coge el Nombre y no el Archivo
iOS a veces convierte la variable a “Nombre” (texto). Debe ser “Archivo”.

Forzar que sea Archivo (elige una de estas opciones antes del paso 3 “Codificar”):
- Opción 1 (recomendada)
  1) Acción: “Obtener archivos de la entrada” (en algunas versiones se llama “Obtener archivo de la entrada”).
  2) Si la entrada puede traer varios, añade “Obtener elemento de la lista” → Índice 1.
  3) Ahora en “Codificar (Base64)” toca la píldora azul y selecciona esa salida (debe verse como Archivo).
- Opción 2 (coerción rápida)
  1) Acción: “Vista rápida” sobre “Entrada del atajo” (abre una previsualización del GPX).
  2) Elimina “Vista rápida”.
  3) En “Codificar (Base64)”, selecciona de nuevo “Entrada del atajo” (ahora suele quedar como Archivo).
- Opción 3 (detalles)
  1) Acción: “Obtener detalles de archivos” → “Tamaño” sobre “Entrada del atajo”.
  2) Luego “Codificar (Base64)” con “Entrada del atajo” (esto fuerza a tratarlo como datos/archivo).

Comprobación
- Añade &log=1 a la URL final. En consola deberías ver:
  - Base64 decoded length: (miles de bytes, no ~50–100).
  - Si sigue siendo ~50–100, aún estás pasando “Nombre”.


## Alternativa con Scriptable (recomendada si Atajos no lee el archivo)
Scriptable puede leer ficheros y abrir la PWA pasándole el GPX. Elige una de estas variantes:

### Opción 1 — URL con Base64URL (rápida, pero limitada por longitud de URL)
Pega este script en Scriptable (nuevo script) y ejecútalo:

```javascript
// filepath: /Users/sergi/DEVEL/gpx/AYUDA-Atajo-iOS.md
// Scriptable: abrir PWA con GPX en Base64URL
const PWA_URL = "https://lockevod.github.io/gpx/";
const fileURL = await DocumentPicker.open(["public.xml","public.text","public.data"]);
const fm = FileManager.iCloud();
try { await fm.downloadFileFromiCloud(fileURL); } catch (_) {}
const name = fm.fileName(fileURL, true);
const gpxText = fm.readString(fileURL);
const b64 = Data.fromString(gpxText).toBase64String();
const b64url = b64.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const url = `${PWA_URL}#gpx=${encodeURIComponent(b64url)}&name=${encodeURIComponent(name)}&log=1`;
Safari.open(url);
```

Notas
- Si el GPX es grande, la URL puede ser demasiado larga para Safari. En ese caso usa la Opción 2.

### Opción 2 — WebView + postMessage (sin límites de URL)
Carga la PWA en un WebView y envía el GPX con postMessage (la app ya lo soporta):

```javascript
// filepath: /Users/sergi/DEVEL/gpx/AYUDA-Atajo-iOS.md
// Scriptable: abrir PWA en WebView y enviar GPX con postMessage
const PWA_URL = "https://lockevod.github.io/gpx/";

// Elegir archivo GPX
const fileURL = await DocumentPicker.open(["public.xml","public.text","public.data"]);
const fm = FileManager.iCloud();
try { await fm.downloadFileFromiCloud(fileURL); } catch (_) {}
const name = fm.fileName(fileURL, true);
const gpx = fm.readString(fileURL);

// Preparar inyección JS (escapando el contenido)
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
const js = `
  (function(){
    const until = (cond, t=80, d=150) => new Promise(r=>{
      let n=0; const id=setInterval(()=>{ if(cond()){clearInterval(id);r(true);} else if(++n>t){clearInterval(id);r(false);} }, d);
    });
    // Espera opcional a que el loader exista
    until(()=>typeof window.cwLoadGPXFromString==="function").then(()=>{
      window.postMessage({ type:"cw-gpx", name:${JSON.stringify(name)}, gpx:\`${esc(gpx)}\` }, "*");
    });
  })();
`;

// Abrir WebView y enviar GPX
const web = new WebView();
await web.loadURL(PWA_URL);
await web.waitForLoad();
await web.evaluateJavaScript(js);
await web.present(); // opcional: muestra la PWA embebida
```

Comprobación
- Abre la consola con &log=1 si usas la Opción 1: verás “Decoded GPX OK …” y se cargará la ruta.
- En la Opción 2, al presentar el WebView debes ver el mapa con la ruta cargada.


## Envío por GET comprimido (recomendado cuando la URL puede ser larga)

Si vas a pasar el GPX por la URL (query o hash) conviene comprimirlo primero (gzip/zlib) y después pasar la base64URL. La web ya detecta gzip/zlib y usa pako para descomprimir en el cliente.

Ejemplo en Node.js (genera base64URL comprimida y abre la URL):
```js
// filepath: /Users/sergi/DEVEL/meteoride/AYUDA-Atajo-iOS.md
// Node.js: gzip + base64url
const fs = require('fs');
const zlib = require('zlib');

const file = 'ruta.gpx';
const name = 'MiRuta';
const data = fs.readFileSync(file, 'utf8'); // si tu GPX tiene encoding especial, lee como buffer
const gz = zlib.gzipSync(Buffer.from(data, 'utf8')); // gzip compress
let b64 = gz.toString('base64');
// convert to base64url (safe for use in query/hash)
b64 = b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const url = `https://app.meteoride.cc/?gpx=${encodeURIComponent(b64)}&name=${encodeURIComponent(name)}&log=1`;
console.log(url);
```

Notas:
- Usa gzip (no es necesario tar.gz); la app detecta gzip/zlib automáticamente y usa pako para descomprimir.
- Aunque la compresión reduce mucho el tamaño, los navegadores tienen límites prácticos de URL (especialmente en iOS/Safari). Si queda demasiado largo, usa el método WebView/postMessage o el staging via sessionStorage (window.__cw_stageAndReload) que también está soportado.
- Para probar localmente añade &log=1 a la URL para ver logs en consola y en la sección debug de la app.

## Comprimir en Shortcuts (Gzip / tar.gz) y generar base64url

Shortcuts permite crear archivos comprimidos. Aquí tienes dos flujos concretos: gzip directo (más simple) y tar.gz (si necesitas agrupar varios ficheros primero). Al final se codifica el fichero comprimido en Base64 y se transforma a base64url (+→- , /→_ , quitar =).

A) Gzip directo (un solo .gpx)
1. Acción: "Get File" → seleccionar el .gpx (o recibir como entrada).
2. Acción: "Compress Files" (o "Compress") → elegir formato "Gzip" . Resultado: fichero .gz.

3. Acción: "Encode File" → Base64 (entrada: el .gz).
4. Acción: "Replace Text" → Find: "+" Replace: "-" (aplicar a la salida Base64).
5. Acción: "Replace Text" → Find: "/" Replace: "_" .
6. Acción: "Replace Text" → Find: "=" Replace: "" (vacío).
   - Resultado: base64url (texto).
7. Acción: "Encode Text" → URL Encode sobre el nombre de la ruta (opcional).
8. Acción: "Text" → construir la URL:
   https://app.meteoride.cc/?gpx=<BASE64URL>&name=<NAME_URLENCODED>&log=1
9. Acción: "Open URLs".

B) Tar.gz (varios ficheros o prefieres .tar primero)
1. Acción: "Get File" → seleccionar todos los .gpx (o carpeta).
2. Acción: "Make Archive" (o "Compress") → elegir formato "Tar" (resultado: archivo .tar).
3. Acción: "Compress Files" → seleccionar el .tar y elegir "Gzip" (resultado: .tar.gz).
4. Luego acciones 3–9 del flujo A (Encode File → Replace Text → construir URL → Open).

Comprobación y depuración
- Antes de codificar haz "Quick Look" sobre el .gz/.tar.gz para comprobar tamaño.
- Añade &log=1 a la URL para activar logs en la PWA y ver si la descompresión y parseo funciona.
- Si la URL resulta demasiado larga y Safari la rechaza, usa la alternativa "staging" (siguiente sección).

C) Alternativa: staging via sessionStorage (evita URL largas)
- Obtén el fichero comprimido en Shortcuts (pasos anteriores) y codifícalo a Base64 (no hace falta hacer base64url).
- Abre la PWA (Open URLs → https://app.meteoride.cc/).
- Espera 0.7–1.0s.
- Ejecuta "Run JavaScript on Web Page" (Safari) con este código — pega la Base64 (como texto) y el nombre insertando las píldoras:

```js
// En Shortcuts inserta la salida Base64 en B64_PILL y el nombre en NAME_PILL
const name = /* NAME_PILL */;
const b64 = /* B64_PILL */;

// stage into sessionStorage and reload (same-origin handoff the app already supports)
try {
  sessionStorage.setItem('cw_gpx_text', atob(b64)); // store raw GPX or compressed bytes as string
  sessionStorage.setItem('cw_gpx_name', name || 'Shared route');
  location.reload();
} catch (e) {
  console.error('Staging failed', e);
}
completion();
```

Notas importantes
- La app detecta gzip/zlib automáticamente gracias a pako; no es necesario añadir cabeceras.
- base64url reduce caracteres problemáticos en URLs, pero los navegadores siguen teniendo límites (iOS Safari es el más restrictivo). Si la URL excede el límite, usa el flujo de staging (sessionStorage) o el WebView/postMessage (Scriptable).
- Si tienes dudas sobre qué acciones aparecen exactamente en tu versión de iOS, "Quick Look" y "Encode File" ayudan a verificar cada paso.

¿Puedo sustituir las 3 acciones "Replace Text" por una sola con una expresión regular?
- Resumen corto: no. Shortcuts permite usar "Replace Text" con expresiones regulares, pero la acción no ejecuta una función de reemplazo por coincidencia; el texto de reemplazo es estático y no puede variar según el carácter coincidente. Por eso no es posible, en una sola acción nativa, hacer simultáneamente:
  "+" → "-"  y  "/" → "_"
  con reemplazos distintos. Por tanto las opciones prácticas son:

Opciones prácticas
1) Híbrida 100% nativa (2 acciones Replace)
   - Usa una acción "Replace Text" con Regular Expression activa para eliminar el padding:
     - Find (regex): =+$
     - Replace: (vacío)
   - Luego una acción "Replace Text" simple para mapear los símbolos restantes (esta seguirá siendo una sola sustitución que transforma ambos símbolos al mismo carácter si se usa una sola Replace; para mantener ambas distintas necesitarás una segunda Replace):
     - Replace "+" → "-"
     - Replace "/" → "_"
   - Esto conserva todo dentro de Shortcuts sin ejecutar JS, pero sigue siendo 2–3 acciones.

2) Recomendada: un único paso con JavaScript (1 acción)
   - Usa "Run JavaScript on Web Page" (Safari) o cualquier acción que permita ejecutar JS y aceptar la salida Base64 como píldora.
   - Ventaja: una sola acción JS hace las tres transformaciones y devuelve la base64url lista.
   - Snippet listo para pegar (inserta la píldora BASE64_PILL y NAME_PILL en las líneas comentadas):

```javascript
// filepath: /Users/sergi/DEVEL/meteoride/AYUDA-Atajo-iOS.md
(function(){
  // Sustituye las siguientes líneas con las píldoras azules de Shortcuts:
  const b64 = /* BASE64_PILL */;   // salida de "Encode File" (Base64)
  const name = /* NAME_PILL */ || 'Shared route'; // opcional

  // Un solo paso: + -> -, / -> _, quitar padding "="
  const b64url = String(b64).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

  // Construir y abrir la URL (o devolverla a Shortcuts con completion(url))
  const url = `https://app.meteoride.cc/?gpx=${encodeURIComponent(b64url)}&name=${encodeURIComponent(name)}&log=1`;

  // Opción A: redirigir en la página (ejecutado dentro de Safari)
  window.location.href = url;

  // Opción B: devolver la URL a Shortcuts y que Shortcuts la abra (descomenta si la prefieres)
  // completion(url);

  completion();
})();
```

Uso en Shortcuts (resumen)
- "Get File" → "Compress Files" (Gzip) → "Encode File" (Base64) → salida BASE64_PILL.
- "Run JavaScript on Web Page" → pega el snippet anterior y sustituye las píldoras.
- El script redirige a la URL comprimida o puede devolver la URL a Shortcuts usando completion(url).

Notas finales
- Si no quieres abrir Safari para ejecutar JS, la variante híbrida nativa (eliminar padding con un Replace regex y luego hacer dos Replace simples para "+" y "/") es la alternativa sin JS.
- Si necesitas soporte exacto para mapear múltiples caracteres a distintos sustitutos en una sola operación, JS es la opción fiable en iOS Shortcuts.