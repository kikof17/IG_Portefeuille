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

function getDataDirectorySync() {
  const config = readConfig()
  if (typeof config.dataDirectory === 'string' && config.dataDirectory.trim()) {
    return config.dataDirectory
  }
  return path.join(userDataPath, 'data')
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

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  getDataDirectorySync,
  readPortfolioDataSync,
  writePortfolioDataSync,
  clearPortfolioDataSync,
  chooseDataDirectory,
})
