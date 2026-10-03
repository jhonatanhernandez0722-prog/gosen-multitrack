import path from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { ConfigService } from './services/ConfigService'
import { LibraryService } from './services/library/LibraryService'
import { ZipImportService } from './services/import/ZipImportService'
import { HolyricsApiAdapter } from './services/holyrics/HolyricsAdapter'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Gosen Multitrack',
    backgroundColor: '#0e1014',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // El audio debe seguir sonando aunque la ventana quede en segundo plano durante el servicio.
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  // Ningún enlace abre ventanas nuevas dentro de la app; los http(s) van al navegador.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// Una sola instancia: abrir la app dos veces durante un servicio solo enfoca la ventana existente.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // Identidad en la barra de tareas de Windows (agrupa ventanas y accesos directos del instalador).
  if (process.platform === 'win32') app.setAppUserModelId('com.gosen.multitrack')

  void app.whenReady().then(async () => {
    const config = new ConfigService(app.getPath('userData'))
    await config.load()
    const library = new LibraryService(config)
    const zipImport = new ZipImportService(library)
    const holyrics = new HolyricsApiAdapter(config)
    registerIpc({ config, library, zipImport, holyrics, getWindow: () => mainWindow })

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

process.on('uncaughtException', (err) => console.error('[gosen] excepción no controlada:', err))
process.on('unhandledRejection', (err) => console.error('[gosen] promesa rechazada sin manejar:', err))
