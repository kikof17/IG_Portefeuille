/// <reference types="vite/client" />

interface DesktopApi {
	isDesktop: boolean
	getDataDirectorySync: () => string
	readPortfolioDataSync: () => string | null
	writePortfolioDataSync: (content: string) => void
	clearPortfolioDataSync: () => void
	chooseDataDirectory: () => Promise<string | null>
	getUpdateState: () => Promise<{
		status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
		message: string | null
		currentVersion: string
		availableVersion: string | null
		downloadedVersion: string | null
		downloadedFilePath: string | null
	}>
	checkForUpdates: () => Promise<{
		status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
		message: string | null
		currentVersion: string
		availableVersion: string | null
		downloadedVersion: string | null
		downloadedFilePath: string | null
	}>
	downloadUpdate: () => Promise<{
		status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
		message: string | null
		currentVersion: string
		availableVersion: string | null
		downloadedVersion: string | null
		downloadedFilePath: string | null
	}>
	installDownloadedUpdate: () => Promise<{
		status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
		message: string | null
		currentVersion: string
		availableVersion: string | null
		downloadedVersion: string | null
		downloadedFilePath: string | null
	}>
}

interface Window {
	desktopAPI?: DesktopApi
}