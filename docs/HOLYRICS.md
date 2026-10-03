# Integración con Holyrics — qué existe realmente

Fuente: documentación oficial de la API Server — https://github.com/holyrics/API-Server (README-en.md).
Revisada el 2026-10-02.

## Mecanismo

- **HTTP POST + JSON** a `http://[IP]:[PUERTO]/api/{acción}?token=...`
- Se activa en Holyrics: *Archivo › Configuración › API Server*. Los tokens se crean en
  "gestionar permisos", **con permisos por acción** (hay que autorizar cada acción que usemos).
- Alternativa más segura en red local: método "hash" (`Auth` → nonce, `dtoken = sha256(nonce:rid:token:data)`).
- También existe acceso por internet a través del servidor de Holyrics con `API_KEY`.
- Respuesta: `{"status":"ok","data":...}` o `{"status":"error","error":...}`.
- `GetAPIServerInfo` muestra 8091 como puerto de ejemplo; el real se ve en la configuración de Holyrics.

## Acciones útiles para Gosen Multitrack

| Necesidad | Acción oficial | Versión mínima |
| --- | --- | --- |
| Comprobar conexión / permisos | `GetTokenInfo`, `CheckPermissions` | 2.25 |
| Buscar la canción | `SearchSong` (`text`, `title`, `artist`…) | 2.19 |
| Listar canciones | `GetSongs` | 2.21 |
| Leer letra, diapositivas y orden | `GetSong` (`slides[].slide_description`, `order`) | 2.21 |
| Mostrar la letra | `ShowSong` (`id`, `initial_index`) | 2.19 / 2.23 |
| Saber qué se proyecta | `GetCurrentPresentation` (`slide_number`, `total_slides`, `slides`) | 2.19–2.21 |
| Ir a una diapositiva | `ActionGoToIndex` (`index`, base 0) | 2.19 |
| Ir a una sección ("Coro") | `ActionGoToSlideDescription` (`name`) | 2.19 |
| Siguiente / anterior | `ActionNext`, `ActionPrevious` | 2.19 |
| Cerrar la letra | `CloseCurrentPresentation` | 2.19 |

## Lo que NO existe

- **No hay una acción para que Holyrics siga el reloj de un reproductor externo.** Ninguna acción recibe
  "posición actual = X ms" para una canción.
- Las *Presentaciones Automáticas* (`.ap`) sí tienen una línea de tiempo por diapositiva, pero se
  reproducen con el reproductor propio de Holyrics y su propio audio. `GetAP` permite **leer** esa línea
  de tiempo, pero no subordinarla a nuestro reloj.

## Estrategia viable (FASE 8)

Gosen guarda en `song.json` → `holyrics.cues` una lista de marcas `{ time, slideIndex | slideDescription }`.
Durante la reproducción, el reloj maestro del audio detecta cuándo se cruza una marca y envía
`ActionGoToIndex` o `ActionGoToSlideDescription`. Esto usa solo acciones documentadas; la latencia es la
de una petición HTTP en red local (pocos milisegundos), suficiente para cambiar diapositivas.

Opcionalmente, las marcas podrían **importarse** de una Presentación Automática existente (`GetAP` →
`timeline[].start`), si el usuario ya las tiene creadas en Holyrics.

Todo pasa por `HolyricsAdapter` (`src/main/services/holyrics/HolyricsAdapter.ts`): si en el futuro se usa
otro mecanismo (MIDI, método hash, internet), solo cambia la implementación.
