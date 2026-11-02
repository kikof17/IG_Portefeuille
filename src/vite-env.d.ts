/// <reference types="vite/client" />

interface DesktopApi {
	isDesktop: boolean
	getDataDirectorySync: () => string
	readPortfolioDataSync: () => string | null
	writePortfolioDataSync: (content: string) => void
	clearPortfolioDataSync: () => void
	chooseDataDirectory: () => Promise<string | null>
}

interface Window {
	desktopAPI?: DesktopApi
}