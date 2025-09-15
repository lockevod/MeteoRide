Ejemplo exportable de Shortcut (iOS) — flujo "Enviar GPX a MeteoRide"

Este archivo contiene un ejemplo en formato legible con los pasos para crear un Shortcut que sube un GPX a tu servidor local y abre la app web con el GPX cargado.

Pasos (importar manualmente en la app Shortcuts):
1. Añadir acción "Seleccionar archivo" – configuración: tipo "Archivos" (permite escoger .gpx).
2. Añadir acción "Obtener contenido de URL" (Get Contents of URL):
   - URL: http://YOUR_HOST/share  (o en el caso de usar la webapp publicada sería https://app.meteoride.cc/share)
   - Method: POST
   - Headers: Content-Type: application/gpx+xml
   - Request Body: File (usar el output de Get File Contents)
   - Response: Automatically gets the JSON body
4. Añadir acción "Obtener valor del diccionario" (Get Dictionary Value):
   - Input: Resultado de la petición anterior
   - Key: indexUrl
5. Añadir acción "Abrir URL" (Open URLs):
   - URL: "http://YOUR_HOST:8080" + resultado de indexUrl (en el caso de usar la webapp publicada sería https://app.meteoride.cc + resultado de indexUrl')


