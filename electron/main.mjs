import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { autoUpdater } = electronUpdater

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const updateState = {
  status: 'idle',
  message: null,
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadedVersion: null,
  downloadedFilePath: null,
}

function setUpdateState(patch) {
  Object.assign(updateState, patch)
}

function toUpdateErrorMessage(error) {
  const raw = (error?.message ?? '').trim()
  const lowered = raw.toLowerCase()

  if (lowered.includes('404') || lowered.includes('not found')) {
    return 'Impossible de verifier les mises a jour: release introuvable. Verifiez que latest.yml est publie dans la derniere release GitHub.'
  }

  if (lowered.includes('403') || lowered.includes('401') || lowered.includes('authorization') || lowered.includes('authentication') || lowered.includes('token')) {
    return 'Acces refuse a la source de mise a jour. Si le depot est prive, rendez la release publique ou utilisez une source de mise a jour accessible sans authentification.'
  }

  if (lowered.includes('net::err') || lowered.includes('econn') || lowered.includes('timeout') || lowered.includes('network')) {
    return 'Erreur reseau pendant la verification de mise a jour. Verifiez la connexion internet puis reessayez.'
  }

  if (!raw) {
    return 'Erreur de mise a jour inconnue.'
  }

  return `Erreur de mise a jour: ${raw.split('\n')[0]}`
}

function initializeAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      status: 'checking',
      message: 'Recherche de mise a jour en cours.',
      availableVersion: null,
      downloadedVersion: null,
      downloadedFilePath: null,
    })
  })

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      message: `Mise a jour disponible: ${info.version}`,
      availableVersion: info.version,
      downloadedVersion: null,
      downloadedFilePath: null,
    })
  })

  autoUpdater.on('update-not-available', () => {
    setUpdateState({
      status: 'idle',
      message: 'Aucune mise a jour disponible.',
      availableVersion: null,
      downloadedVersion: null,
      downloadedFilePath: null,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number.isFinite(progress.percent) ? progress.percent.toFixed(1) : '0.0'
    setUpdateState({
      status: 'downloading',
      message: `Telechargement en cours (${percent}%).`,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'downloaded',
      message: `Mise a jour prete: ${info.version}`,
      downloadedVersion: info.version,
      downloadedFilePath: info.downloadedFile,
    })
  })

  autoUpdater.on('error', (error) => {
    setUpdateState({
      status: 'error',
      message: toUpdateErrorMessage(error),
    })
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const startUrl = process.env.ELECTRON_START_URL
  if (startUrl) {
    void window.loadURL(startUrl)
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.on('desktop:get-user-data-path', (event) => {
  event.returnValue = app.getPath('userData')
})

ipcMain.handle('desktop:choose-data-directory', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choisir le dossier des donnees Portefeuille IG',
    properties: ['openDirectory', 'createDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('desktop:update-get-state', () => {
  return { ...updateState }
})

ipcMain.handle('desktop:update-check', async () => {
  if (!app.isPackaged) {
    setUpdateState({ status: 'error', message: 'La mise a jour automatique est disponible uniquement dans l application installee.' })
    return { ...updateState }
  }

  try {
    await autoUpdater.checkForUpdates()
    return { ...updateState }
  } catch (error) {
    setUpdateState({ status: 'error', message: toUpdateErrorMessage(error) })
    return { ...updateState }
  }
})

ipcMain.handle('desktop:update-download', async () => {
  if (!app.isPackaged) {
    setUpdateState({ status: 'error', message: 'La mise a jour automatique est disponible uniquement dans l application installee.' })
    return { ...updateState }
  }

  try {
    await autoUpdater.downloadUpdate()
    return { ...updateState }
  } catch (error) {
    setUpdateState({ status: 'error', message: toUpdateErrorMessage(error) })
    return { ...updateState }
  }
})

ipcMain.handle('desktop:update-install', () => {
  if (!app.isPackaged) {
    setUpdateState({ status: 'error', message: 'La mise a jour automatique est disponible uniquement dans l application installee.' })
    return { ...updateState }
  }

  if (updateState.status !== 'downloaded') {
    setUpdateState({ status: 'error', message: 'Aucune mise a jour telechargee a installer.' })
    return { ...updateState }
  }

  autoUpdater.quitAndInstall()
  return { ...updateState }
})

app.whenReady().then(() => {
  initializeAutoUpdater()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
