# MeteoRide

Claude Code lee este fichero solo en cada sesión. Lo demás hay que abrirlo:

- **`AGENTS.md`** — la memoria del proyecto: decisiones, modelo de seguridad, el
  shell nativo, las trampas encontradas por el camino y el trabajo abierto. Léelo
  entero antes de tocar nada.
- **`docs/HANDOFF.md`** — estado de la app nativa iOS/Android y, en la sección 9, lo
  que queda pendiente de decidir.
- **`docs/REVIEW-2026-09-14.md`** — revisión externa de seis hallazgos, los seis
  abiertos y los seis reproducidos contra esta rama.

## Convenciones que no se negocian

- Rama de trabajo: `main`. La rama `native-ios-capacitor` se fusionó en `main`
  (PR #1, `baf7f8e`, 16/09/2026) y se borró.
- Commits como `Enderthor <58392928+lockevod@users.noreply.github.com>`, **sin
  ninguna atribución de IA**: ni `Co-Authored-By`, ni identificadores de modelo, ni
  menciones en comentarios, mensajes de commit o texto de PR.
- Cada test nuevo se comprueba por mutación: rompe el código que debería cazar y
  confirma que el test falla. Varios tests de aquí pasaron contra el código roto a la
  primera y hubo que reescribirlos.
- `cd mobile && npm test` antes de cada commit. Ese script reconstruye el bundle;
  `npx playwright test` a secas no, así que prueba el `www/` anterior.
- **Nunca dos suites a la vez**: comparten el puerto 4173 y el directorio `www/`.
- Actualiza `AGENTS.md` cuando cambies algo que un lector no deduciría del código.
