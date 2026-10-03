# Gosen Multitrack — Arquitectura

## Stack

| Capa | Tecnología | Motivo |
| --- | --- | --- |
| Aplicación de escritorio | **Electron** | Acceso completo al disco, instalador Windows (NSIS), y un motor de audio (Chromium Web Audio) probado. No hay Rust/.NET instalados; Node sí. |
| Build | **electron-vite** + **TypeScript** | Compila main / preload / renderer por separado con una sola configuración. |
| UI | **React** + CSS propio (tokens) | Sin librerías de UI ni de estado: menos dependencias. |
| ZIP | **yauzl** | Lectura en streaming (WAV grandes sin cargar todo el ZIP en memoria), valida entradas y permite controlar cada ruta. |
| Instalador | **electron-builder** (NSIS) | Estándar para Windows; compatible con `electron-updater` para actualizaciones futuras. |

## Procesos y responsabilidades

```
┌───────────────────────────── main (Node) ─────────────────────────────┐
│ ConfigService      settings.json + token cifrado (safeStorage/DPAPI)  │
│ LibraryService     escaneo de MusicLibrary, song.json                 │
│ ZipImportService   (FASE 3) validación + extracción segura            │
│ HolyricsAdapter    interfaz ← HolyricsApiAdapter → HolyricsClient HTTP │
│ ipc.ts             capa fina: valida, delega, devuelve Result<T>      │
└──────────────────────────────▲─────────────────────────────────────────┘
                               │ contextBridge (window.gosen), sin Node en la UI
┌──────────────────────────── renderer (UI) ─────────────────────────────┐
│ audio/AudioEngine    (FASE 4) AudioContext, buffers, grafo de ganancia │
│ audio/Transport      (FASE 4) reloj maestro, play/pause/seek          │
│ state/               contexto de configuración, estado Holyrics        │
│ screens/ components/ solo presentación                                 │
└────────────────────────────────────────────────────────────────────────┘
```

Seguridad de la ventana: `contextIsolation`, `sandbox`, sin `nodeIntegration`, CSP estricta, navegación y
ventanas nuevas bloqueadas. Todas las rutas que llegan desde la UI o desde un ZIP pasan por
`resolveInside()` (impide `..`, rutas absolutas, unidades y UNC).

## Motor de audio: Web Audio API

Un único `AudioContext` y su reloj de hardware (`currentTime`) es el **reloj maestro**.

```
AudioBufferSourceNode ─► GainNode (volumen pista) ─► GainNode (mute/solo) ─┐
AudioBufferSourceNode ─► GainNode               ─► GainNode            ─┤─► GainNode master ─► salida
...                                                                       ┘
```

- **Play**: `t0 = ctx.currentTime + margen`; cada pista hace `source.start(t0, offset)`. Todas arrancan en el
  mismo frame de audio (precisión de muestra), no "más o menos a la vez".
- **Posición** = `offset + (ctx.currentTime − t0)`. La línea de tiempo lee este valor en
  `requestAnimationFrame` solo para pintar; nunca se usa `setInterval` para el audio.
- **Pause / Seek**: se guarda la posición, se detienen las fuentes (son de un solo uso) y se crean nuevas
  arrancando todas juntas en el nuevo `offset`.
- **Mute / Solo / Volumen**: solo cambian ganancias con rampas cortas (sin clics). La pista nunca se detiene.
- **Duraciones distintas**: la duración maestra es la pista más larga; las más cortas terminan antes y quedan
  en silencio. No se estira ni se recorta audio.
- **Salida**: `AudioContext.setSinkId()` para elegir dispositivo.
- **Memoria**: los buffers decodificados son PCM float32 (~21 MB por minuto por pista estéreo a 44.1 kHz).
  Una canción de 5 min con 8 pistas ≈ 850 MB. Aceptable en un PC actual; solo se mantiene cargada la
  canción activa. Si fuera un problema, la alternativa es streaming propio con AudioWorklet.

Formatos: WAV y MP3 activados (`src/shared/audioFormats.ts`). FLAC/OGG/M4A los decodifica Chromium y
pueden activarse tras probarlos.

## Almacenamiento

```
MusicLibrary/                     (ruta configurable, recordada en settings.json)
  Eres Todopoderoso/
    song.json
    tracks/
      bateria.wav
      ...
```

- El disco es la fuente de verdad: no hay base de datos que pueda desincronizarse.
- `song.json` se escribe de forma atómica (temporal + rename, con reintentos si Windows bloquea el archivo).
- Configuración: `%APPDATA%/Gosen Multitrack/settings.json`. Token de Holyrics: `holyrics-token.bin`
  cifrado con DPAPI; nunca llega a la UI.

## Importación ZIP

1. `inspect()` lee solo el índice del ZIP (no escribe nada): detecta WAV/MP3, ignora `__MACOSX`, ocultos y
   otros archivos, y propone nombre (carpeta común o nombre del ZIP) y tipo de cada pista por su nombre.
2. El usuario revisa nombre, artista, nombres/tipos y qué pistas incluir.
3. `commit()` extrae a `MusicLibrary/.import-<uuid>/`, comprueba la cabecera real de cada archivo y, solo si
   todo es correcto, renombra la carpeta a su nombre definitivo. Si algo falla, se borra la carpeta temporal.

Seguridad: ZIPs con rutas `..` o absolutas se rechazan enteros; límites de tamaño contados sobre los bytes
reales; los archivos se crean con `wx` (nunca sobrescriben); nada del ZIP se ejecuta.
Reimportar extrae igual y luego intercambia carpetas (la antigua va a la Papelera), conservando id,
vínculo con Holyrics y marcas.

## Eliminación

Nada se borra de forma definitiva: canciones, pistas quitadas y archivos reemplazados van a la Papelera de
reciclaje, siempre tras una confirmación nativa pedida desde el proceso principal.

## Pruebas

- `npm run fixtures` genera WAV y ZIPs de prueba (válidos, corruptos, vacíos, sin audio, falsos, con path traversal).
- `npm run selftest` ejecuta los servicios reales en carpetas temporales y luego abre la UI oculta, reproduce
  una canción y comprueba contra un servidor que responde con el formato oficial de Holyrics que se envían
  `ShowSong` y `ActionGoToIndex` en el momento de cada marca. Guarda capturas en `test-output/`.

## Fases

1. Arquitectura + proyecto funcional ✅
2. Biblioteca local: buscar, crear, editar, eliminar (Papelera), abrir carpeta ✅
3. Importación ZIP con vista previa, edición y reimportación ✅
4. Reproductor multipista sincronizado ✅
5. Mute / solo / volumen por pista y general / dispositivo de salida ✅
6. Persistencia: mezcla por defecto, duraciones, añadir/reemplazar/quitar pistas ✅
7. Integración Holyrics: buscar, vincular, mostrar, cerrar ✅
8. Sincronización de letras por marcas de tiempo (editor + modo ensayo) ✅
9. Pulido de UI (pendiente de revisión con uso real)
10. Build e instalador Windows
