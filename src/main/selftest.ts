/**
 * Autoprueba de integración: `npm run selftest`.
 * Ejecuta los servicios reales contra test-fixtures/ en carpetas temporales, y después abre la UI
 * oculta, reproduce una canción y comprueba (con un servidor simulado que responde con el formato de
 * la documentación oficial de Holyrics) que se envían ShowSong y ActionGoToIndex en su momento.
 * No toca la configuración ni la biblioteca reales del usuario.
 */
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { ConfigService } from './services/ConfigService'
import { LibraryService } from './services/library/LibraryService'
import { ZipImportService } from './services/import/ZipImportService'
import { HolyricsApiAdapter } from './services/holyrics/HolyricsAdapter'
import { registerIpc } from './ipc'
import { resolveInside } from './fs/safePath'
import { toAppError } from './errors'

const FIXTURES = path.resolve(__dirname, '../../test-fixtures')
let failures = 0
const ok = (cond: unknown, label: string) => {
  if (cond) console.log(`  ✔ ${label}`)
  else {
    failures++
    console.log(`  ✘ ${label}`)
  }
}
async function expectCode(p: Promise<unknown>, code: string, label: string) {
  try {
    await p
    ok(false, `${label} (no lanzó error, se esperaba ${code})`)
  } catch (err) {
    const e = toAppError(err)
    ok(e.code === code, `${label} → ${e.code}: ${e.message}`)
  }
}

const tmp = path.join(os.tmpdir(), `gosen-selftest-${Date.now()}`)
app.setPath('userData', path.join(tmp, 'userData'))

void app.whenReady().then(async () => {
  try {
    await run()
  } catch (err) {
    failures++
    console.error('Error inesperado en la autoprueba:', err)
  }
  console.log(failures ? `\n${failures} comprobaciones FALLARON` : '\nTodas las comprobaciones pasaron')
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  app.exit(failures ? 1 : 0)
})

async function run() {
  const libDir = path.join(tmp, 'MusicLibrary')
  await fs.mkdir(libDir, { recursive: true })
  const config = new ConfigService(app.getPath('userData'))
  await config.load()
  const library = new LibraryService(config)
  const zipImport = new ZipImportService(library)

  console.log('\nRutas seguras')
  ok(resolveInside(libDir, 'a/b.wav').startsWith(libDir), 'ruta relativa normal')
  for (const bad of ['../x', 'a/../../x', 'C:/x', '/x', '\\\\server\\x', '..\\x']) {
    let threw = false
    try {
      resolveInside(libDir, bad)
    } catch {
      threw = true
    }
    ok(threw, `rechaza "${bad}"`)
  }

  console.log('\nBiblioteca sin configurar')
  await expectCode(library.scan(), 'LIBRARY_NOT_CONFIGURED', 'scan sin carpeta')
  await config.update({ libraryPath: libDir })
  const settingsRaw = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'))
  ok(settingsRaw.libraryPath === libDir, 'la ruta de biblioteca se recuerda en settings.json')

  console.log('\nZIPs inválidos')
  await expectCode(zipImport.inspect(path.join(FIXTURES, 'Corrupt.zip')), 'INVALID_ZIP', 'ZIP corrupto')
  await expectCode(zipImport.inspect(path.join(FIXTURES, 'Empty.zip')), 'EMPTY_ZIP', 'ZIP vacío')
  await expectCode(zipImport.inspect(path.join(FIXTURES, 'No_Audio.zip')), 'NO_AUDIO_IN_ZIP', 'ZIP sin audio')
  await expectCode(zipImport.inspect(path.join(FIXTURES, 'Traversal.zip')), 'INVALID_ZIP', 'ZIP con path traversal')
  const parentFiles = await fs.readdir(tmp)
  ok(!parentFiles.some((f) => f.includes('evil')), 'nada se escribió fuera de la biblioteca')

  const fake = await zipImport.inspect(path.join(FIXTURES, 'Fake_Audio.zip'))
  await expectCode(
    zipImport.commit({ importId: fake.importId, name: 'Fake', artist: '', tracks: fake.tracks.map((t) => ({ entryName: t.entryName, name: t.suggestedName, type: t.suggestedType })) }),
    'UNSUPPORTED_FORMAT',
    'WAV falso (cabecera inválida)'
  )
  ok((await fs.readdir(libDir)).length === 0, 'la importación fallida no dejó carpetas a medias')

  console.log('\nImportación ZIP válida')
  const preview = await zipImport.inspect(path.join(FIXTURES, 'Cancion_Eres_Todopoderoso.zip'))
  ok(preview.suggestedName === 'Eres Todopoderoso', `nombre sugerido desde la carpeta: "${preview.suggestedName}"`)
  ok(preview.tracks.length === 4, `4 pistas detectadas (${preview.tracks.map((t) => `${t.fileName}:${t.suggestedType}`).join(', ')})`)
  ok(preview.ignored.some((f) => f.endsWith('notas.txt')), 'notas.txt ignorado')
  ok(!preview.tracks.some((t) => t.entryName.includes('__MACOSX')), '__MACOSX ignorado')
  const types = Object.fromEntries(preview.tracks.map((t) => [t.fileName, t.suggestedType]))
  ok(types['bateria.wav'] === 'drums' && types['bajo.wav'] === 'bass' && types['guitarra.wav'] === 'guitar' && types['voces.wav'] === 'vocals', 'tipos detectados por nombre')

  const entry = await zipImport.commit({
    importId: preview.importId,
    name: preview.suggestedName,
    artist: 'Prueba',
    tracks: preview.tracks.map((t) => ({ entryName: t.entryName, name: t.suggestedName, type: t.suggestedType }))
  })
  const songDir = path.join(libDir, entry.folderName)
  const songJson = JSON.parse(await fs.readFile(path.join(songDir, 'song.json'), 'utf8'))
  ok(songJson.tracks.length === 4 && songJson.tracks.every((t: { file: string }) => t.file.startsWith('tracks/')), 'song.json con rutas tracks/*')
  ok((await fs.readdir(path.join(songDir, 'tracks'))).length === 4, '4 archivos extraídos en /tracks')
  ok(!(await fs.readdir(libDir)).some((f) => f.startsWith('.import-')), 'carpeta temporal eliminada')

  const dupPreview = await zipImport.inspect(path.join(FIXTURES, 'Cancion_Eres_Todopoderoso.zip'))
  ok(dupPreview.duplicateOf?.id === entry.song.id, 'detecta canción duplicada en la vista previa')
  await expectCode(
    zipImport.commit({ importId: dupPreview.importId, name: 'eres todopoderoso', artist: '', tracks: [{ entryName: dupPreview.tracks[0]!.entryName, name: 'x', type: 'other' }] }),
    'DUPLICATE_SONG',
    'duplicado (sin distinguir mayúsculas)'
  )

  const p2 = await zipImport.inspect(path.join(FIXTURES, 'Tracks_Folder.zip'))
  ok(p2.suggestedName === 'Tracks Folder', `estructura /tracks/*.wav → nombre del ZIP: "${p2.suggestedName}"`)
  const p3 = await zipImport.inspect(path.join(FIXTURES, 'Flat_Song.zip'))
  ok(p3.suggestedName === 'Flat Song' && p3.tracks.length === 2, `estructura plana *.wav: "${p3.suggestedName}"`)
  zipImport.cancel(p2.importId)
  zipImport.cancel(p3.importId)

  console.log('\nEdición y persistencia')
  await library.updateSong(entry.song.id, { holyrics: { enabled: true, holyricsSongId: '123', songName: 'Eres Todopoderoso', cues: [{ time: 1.5, slideIndex: 1 }, { time: 0.5, slideIndex: 0 }] } })
  let e2 = await library.getEntry(entry.song.id)
  ok(e2.song.holyrics.cues[0]!.time === 0.5, 'las marcas se guardan ordenadas por tiempo')
  e2 = await library.addTrackFiles(entry.song.id, [path.join(FIXTURES, 'single.wav')])
  ok(e2.song.tracks.length === 5, 'añadir archivo de pista')
  await expectCode(library.addTrackFiles(entry.song.id, [path.join(FIXTURES, 'Empty.zip')]), 'UNSUPPORTED_FORMAT', 'rechaza archivo no compatible')

  const re = await zipImport.inspect(path.join(FIXTURES, 'Tracks_Folder.zip'))
  const reimported = await zipImport.commit({
    importId: re.importId,
    name: 'Eres Todopoderoso',
    artist: 'Prueba',
    tracks: re.tracks.map((t) => ({ entryName: t.entryName, name: t.suggestedName, type: t.suggestedType })),
    replaceSongId: entry.song.id
  })
  ok(reimported.song.id === entry.song.id && reimported.song.tracks.length === 2, 'reimportar conserva el id y reemplaza pistas')
  ok(reimported.song.holyrics.holyricsSongId === '123' && reimported.song.holyrics.cues.length === 2, 'reimportar conserva vínculo Holyrics y marcas')

  console.log('\nArchivos dañados o eliminados a mano')
  await fs.mkdir(path.join(libDir, 'Rota'))
  await fs.writeFile(path.join(libDir, 'Rota', 'song.json'), '{ esto no es json')
  const firstTrack = reimported.song.tracks[0]!
  await fs.rm(path.join(libDir, reimported.folderName, firstTrack.file))
  const scan = await library.scan()
  ok(scan.errors.some((er) => er.folderName === 'Rota'), 'song.json corrupto se informa sin romper el escaneo')
  const scanned = scan.entries.find((x) => x.song.id === entry.song.id)
  ok(scanned?.missingTrackIds.includes(firstTrack.id), 'pista eliminada manualmente se marca como faltante')
  await expectCode(library.readTrack(entry.song.id, firstTrack.id), 'NOT_FOUND', 'leer pista faltante')
  await fs.rm(path.join(libDir, 'Rota'), { recursive: true })

  // Restaurar una canción completa para la prueba de UI.
  await fs.rm(path.join(libDir, reimported.folderName), { recursive: true })
  const uiPreview = await zipImport.inspect(path.join(FIXTURES, 'Cancion_Eres_Todopoderoso.zip'))
  const uiSong = await zipImport.commit({
    importId: uiPreview.importId,
    name: 'Eres Todopoderoso',
    artist: 'Prueba',
    tracks: uiPreview.tracks.map((t) => ({ entryName: t.entryName, name: t.suggestedName, type: t.suggestedType }))
  })
  await library.updateSong(uiSong.song.id, {
    holyrics: { enabled: true, holyricsSongId: '123', songName: 'Eres Todopoderoso', cues: [{ time: 0.8, slideIndex: 0 }, { time: 1.6, slideIndex: 1 }, { time: 2.4, slideDescription: 'Coro' }] }
  })

  await runUiTest(config, library, zipImport)
}

/** Servidor que responde como la API Server de Holyrics según su documentación y registra las llamadas. */
function startHolyricsStub(): Promise<{ port: number; calls: { action: string; body: unknown; at: number }[]; close: () => void }> {
  const calls: { action: string; body: unknown; at: number }[] = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const action = url.pathname.replace('/api/', '')
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const send = (obj: unknown) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(obj))
      }
      if (url.searchParams.get('token') !== 'tok') return send({ status: 'error', error: 'invalid token' })
      calls.push({ action, body: raw ? JSON.parse(raw) : {}, at: Date.now() })
      switch (action) {
        case 'GetTokenInfo':
          return send({ status: 'ok', data: { version: '2.25.0', permissions: 'SearchSong,ShowSong' } })
        case 'SearchSong':
          return send({ status: 'ok', data: [{ id: '123', title: 'Eres Todopoderoso', artist: '' }] })
        case 'GetCurrentPresentation':
          return send({ status: 'ok', data: null })
        case 'GetSong':
          return send({ status: 'ok', data: { id: '123', title: 'Eres Todopoderoso', order: '1,2,1', slides: [{ text: 'Verso', slide_description: 'Verso 1' }, { text: 'Coro', slide_description: 'Coro' }] } })
        default:
          return send({ status: 'ok' })
      }
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({ port, calls, close: () => server.close() })
    })
  )
}

async function runUiTest(config: ConfigService, library: LibraryService, zipImport: ZipImportService) {
  console.log('\nHolyrics (servidor simulado con el formato oficial)')
  const stub = await startHolyricsStub()
  const holyrics = new HolyricsApiAdapter(config)
  ok((await holyrics.status()).state === 'disabled', 'estado "desactivado" por defecto')
  await config.update({ holyrics: { enabled: true, host: '127.0.0.1', port: stub.port, autoShowOnPlay: true } })
  ok((await holyrics.status()).state === 'not-configured', 'sin token → "sin configurar"')
  await config.setHolyricsToken('mal')
  ok((await holyrics.status()).state === 'error', 'token incorrecto → error')
  await config.setHolyricsToken('tok')
  const st = await holyrics.status()
  ok(st.state === 'connected' && st.version === '2.25.0', 'conectado y lee la versión')
  const tokenFile = await fs.readFile(path.join(app.getPath('userData'), 'holyrics-token.bin'))
  ok(!tokenFile.toString('latin1').includes('tok'), 'el token se guarda cifrado')
  const found = await holyrics.searchSongs('eres')
  ok(found[0]?.id === '123', 'SearchSong')
  const slides = await holyrics.getSlides('123')
  ok(slides.source === 'song' && slides.slides.length === 3 && slides.slides[2]!.slideDescription === 'Verso 1', 'GetSong + order → 3 diapositivas')
  stub.calls.length = 0

  console.log('\nUI y reproducción sincronizada')
  // Ventana visible pero fuera de la pantalla: capturePage necesita una ventana que se haya pintado.
  const win = new BrowserWindow({
    show: false,
    x: -3000,
    y: -3000,
    skipTaskbar: true,
    focusable: false,
    width: 1280,
    height: 800,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
  })
  win.webContents.setAudioMuted(true)
  registerIpc({ config, library, zipImport, holyrics, getWindow: () => win })
  const consoleErrors: string[] = []
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') consoleErrors.push(e.message)
  })
  await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.showInactive()

  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true)
  const waitFor = async (code: string, label: string, timeout = 8000) => {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await js<boolean>(code)) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    ok(false, `tiempo agotado esperando: ${label}`)
    return false
  }

  await waitFor(`!!document.querySelector('.play-chip')`, 'lista de la biblioteca')
  ok(await js<boolean>(`document.body.innerText.includes('Eres Todopoderoso')`), 'la canción aparece en la biblioteca')
  await capture(win, 'library')

  await js(`document.querySelector('.play-chip').click()`)
  await waitFor(`document.querySelectorAll('.channel:not(.master-channel)').length === 4 && !!document.querySelector('.state-ready')`, 'pistas decodificadas')
  ok(await js<boolean>(`document.querySelector('.clock-sub').textContent.includes('/ 00:06')`), 'duración maestra = pista más larga (6 s, guitarra dura 5,5 s)')

  // Mute de una pista ANTES de reproducir, para comprobar que no la detiene.
  await js(`document.querySelectorAll('.mbtn.mute')[2].click()`)
  await js(`document.querySelector('.tbtn-play').click()`)
  const t0 = Date.now()
  await waitFor(`document.querySelector('.tbtn-play').classList.contains('is-playing')`, 'estado reproduciendo')
  await new Promise((r) => setTimeout(r, 3000))
  const shown = (await js<string>(`document.querySelector('.timecode').textContent`)).slice(0, 5)
  ok(shown === '00:02' || shown === '00:03', `la línea de tiempo avanza con el reloj de audio (${shown} tras ~3 s)`)
  await capture(win, 'player')

  // GetTokenInfo lo envía el indicador de estado periódicamente; no forma parte de la secuencia.
  const actions = stub.calls.map((c) => c.action).filter((a) => a !== 'GetTokenInfo')
  ok(actions[0] === 'ShowSong', `ShowSong al reproducir (${actions.join(', ')})`)
  const goIdx = stub.calls.filter((c) => c.action === 'ActionGoToIndex')
  ok(goIdx.length >= 2 && (goIdx[0]!.body as { index: number }).index === 0 && (goIdx[1]!.body as { index: number }).index === 1, 'ActionGoToIndex 0 y luego 1')
  const second = goIdx[1]
  if (second) {
    const delta = second.at - t0
    ok(delta > 1400 && delta < 2200, `la marca de 1,6 s llegó a los ${delta} ms del clic (incluye margen de arranque)`)
  }
  ok(stub.calls.some((c) => c.action === 'ActionGoToSlideDescription' && (c.body as { name: string }).name === 'Coro'), 'marca por sección → ActionGoToSlideDescription "Coro"')

  await js(`document.querySelector('.tbtn-play').click()`)
  await waitFor(`!document.querySelector('.tbtn-play').classList.contains('is-playing')`, 'pausa')
  const paused = await js<string>(`document.querySelector('.timecode').textContent`)
  await new Promise((r) => setTimeout(r, 600))
  ok(paused === (await js<string>(`document.querySelector('.timecode').textContent`)), 'en pausa el tiempo no avanza')
  ok(await js<boolean>(`!!document.querySelector('.wave-canvas')`), 'forma de onda dibujada')
  const dropRes = await js<string>(`window.gosen.import.inspectDroppedFile(new File(['x'], 'falso.zip')).then(r => r.ok ? 'ok' : r.error.code)`)
  ok(dropRes === 'INVALID_PATH', `arrastrar: un archivo sin ruta real se rechaza de forma segura (${dropRes})`)
  await js(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'cancion.zip')); window.__dt = dt; window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true })) })()`)
  ok(await js<boolean>(`!!document.querySelector('.drop-overlay')`), 'arrastrar: aparece el aviso "Suelta el ZIP"')
  await js(`window.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, bubbles: true, cancelable: true }))`)
  await waitFor(`!document.querySelector('.drop-overlay') && document.body.innerText.includes('Guarda primero el ZIP')`, 'mensaje tras soltar')
  ok(true, 'arrastrar: al soltar se procesa el archivo y se informa al usuario')

  // Instalación nueva: sin carpeta de biblioteca, soltar un ZIP debe pedir la carpeta (no bloquearse).
  const savedLib = config.libraryPath
  await config.update({ libraryPath: null })
  await js(`location.reload()`)
  await waitFor(`document.body.innerText.includes('Usar Documentos')`, 'pantalla de primera configuración')
  await js(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'cancion.zip')); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })) })()`)
  await waitFor(`document.body.innerText.includes('¿Dónde guardamos tus canciones?')`, 'diálogo de carpeta al soltar sin biblioteca')
  ok(await js<boolean>(`document.body.innerText.includes('cancion.zip')`), 'arrastrar sin biblioteca: pide la carpeta y recuerda el ZIP soltado')
  await config.update({ libraryPath: savedLib })
  await js(`location.reload()`)
  await waitFor(`!!document.querySelector('.play-chip')`, 'biblioteca restaurada')

  // Captura con la demo musical si existe en Descargas (solo visual).
  const demoZip = path.join(app.getPath('downloads'), 'Demo_Gosen_Multitrack.zip')
  if (await fs.access(demoZip).then(() => true, () => false)) {
    const dp = await zipImport.inspect(demoZip)
    const demo = await zipImport.commit({ importId: dp.importId, name: dp.suggestedName, artist: 'Gosen', tracks: dp.tracks.map((t) => ({ entryName: t.entryName, name: t.suggestedName, type: t.suggestedType })) })
    await library.updateSong(demo.song.id, {
      bpm: 76,
      key: 'D',
      holyrics: { enabled: true, holyricsSongId: '123', songName: 'Demo', cues: [{ time: 0, label: 'Intro', slideIndex: 0 }, { time: 12.6, label: 'Verso 1', slideIndex: 1 }, { time: 37.9, label: 'Coro', slideIndex: 2 }, { time: 63.2, label: 'Verso 2', slideIndex: 3 }, { time: 88.4, label: 'Coro', slideIndex: 4 }, { time: 113.7, label: 'Final', slideIndex: 5 }] }
    })
    await js(`location.reload()`)
    await waitFor(`document.querySelectorAll('.play-chip').length >= 2`, 'biblioteca con demo')
    await capture(win, 'library')
    await js(`[...document.querySelectorAll('tr')].find(r => r.innerText.includes('Demo')).querySelector('.play-chip').click()`)
    await waitFor(`!!document.querySelector('.state-ready')`, 'demo cargada', 20000)
    await js(`document.querySelectorAll('.mbtn.mute')[0].click()`)
    await js(`document.querySelector('.tbtn-play').click()`)
    await new Promise((r) => setTimeout(r, 500))
    // Saltar al coro (+5 s por flecha) para que suenen todas las pistas.
    await js(`(() => { const w = document.querySelector('.wave'); for (let i = 0; i < 8; i++) w.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })()`)
    await new Promise((r) => setTimeout(r, 2500))
    await capture(win, 'player-demo')
    ok(await js<boolean>(`getComputedStyle(document.querySelector('.meter')).getPropertyValue('--level') !== ''`), 'los medidores reciben nivel')
  }
  ok(consoleErrors.length === 0, `sin errores en la consola${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`)

  win.destroy()
  stub.close()
}

async function capture(win: BrowserWindow, name: string) {
  const dir = path.resolve(__dirname, '../../test-output')
  await fs.mkdir(dir, { recursive: true })
  try {
    const img = await win.webContents.capturePage()
    await fs.writeFile(path.join(dir, `${name}.png`), img.toPNG())
  } catch (err) {
    console.log(`  (no se pudo capturar ${name}: ${(err as Error).message})`)
  }
}
