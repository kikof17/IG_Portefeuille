import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
