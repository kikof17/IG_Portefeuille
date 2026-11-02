const { contextBridge, ipcRenderer } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const userDataPath = ipcRenderer.sendSync('desktop:get-user-data-path')
const configPath = path.join(userDataPath, 'storage-config.json')

function readConfig() {
  try {
    if (!fs.existsSync(configPath)) return {}
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeConfig(config) {
  fs.mkdirSync(userDataPath, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

function getDefaultDataDirectorySync() {
  return path.join(userDataPath, 'data')
}

function getDataDirectorySync() {
  const config = readConfig()
  if (typeof config.dataDirectory === 'string' && config.dataDirectory.trim()) {
    const configuredDirectory = config.dataDirectory.trim()
    try {
      fs.mkdirSync(configuredDirectory, { recursive: true })
      return configuredDirectory
    } catch {
      const fallbackDirectory = getDefaultDataDirectorySync()
      writeConfig({ ...config, dataDirectory: fallbackDirectory })
      return fallbackDirectory
    }
  }
  return getDefaultDataDirectorySync()
}

function getDataFilePathSync() {
  return path.join(getDataDirectorySync(), 'portfolio-data.json')
}

function readPortfolioDataSync() {
  const filePath = getDataFilePathSync()
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}

function writePortfolioDataSync(content) {
  const filePath = getDataFilePathSync()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function clearPortfolioDataSync() {
  const filePath = getDataFilePathSync()
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

async function chooseDataDirectory() {
  const selected = await ipcRenderer.invoke('desktop:choose-data-directory')
  if (!selected) return null
  const config = readConfig()
  writeConfig({ ...config, dataDirectory: selected })
  return selected
}

function getUpdateState() {
  return ipcRenderer.invoke('desktop:update-get-state')
}

function checkForUpdates() {
  return ipcRenderer.invoke('desktop:update-check')
}

function downloadUpdate() {
  return ipcRenderer.invoke('desktop:update-download')
}

function installDownloadedUpdate() {
  return ipcRenderer.invoke('desktop:update-install')
}

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  getDataDirectorySync,
  readPortfolioDataSync,
  writePortfolioDataSync,
  clearPortfolioDataSync,
  chooseDataDirectory,
  getUpdateState,
  checkForUpdates,
  downloadUpdate,
  installDownloadedUpdate,
})
