import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  CircleHelp,
  Database,
  LayoutDashboard,
  Layers3,
  LineChart,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ReceiptText,
  ShieldCheck,
  Settings,
  Sparkles,
  Wallet,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { AssetClass, PortfolioData, QdfConstituent, Transaction, TransactionKind } from './domain/portfolio'
import { calculatePortfolio, calculateQdfHoldings, type PortfolioSnapshot } from './services/portfolioCalculation'
import { downloadPortfolioWorkbook, downloadTransactionsCsv } from './services/portfolioExport'
import { addAuditEntry, recordPortfolioHistory } from './services/portfolioLifecycle'
import { validatePortfolio } from './services/portfolioValidation'

type Navigation = 'Vue d’ensemble' | 'Positions' | 'Cours' | 'Gestion QDF' | 'Journal des transactions' | 'Rééquilibrage' | 'Historique' | 'Contrôles' | 'Données locales' | 'Paramètres'

const pageTitles: Record<Navigation, string> = {
  'Vue d’ensemble': 'Bonjour Christophe',
  Positions: 'Vos positions',
  Cours: 'Cours des instruments',
  'Gestion QDF': 'Gestion QDF',
  'Journal des transactions': 'Journal des transactions',
  Rééquilibrage: 'Rééquilibrer le portefeuille',
  Historique: 'Historique de performance',
  Contrôles: 'Contrôles des données',
  'Données locales': 'Données locales',
  Paramètres: 'Paramètres du portefeuille',
}

function euro(value: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value)
}

type DesktopUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  message: string | null
  currentVersion: string
  availableVersion: string | null
  downloadedVersion: string | null
  downloadedFilePath: string | null
}

function App() {
  const [active, setActive] = useState<Navigation>('Vue d’ensemble')
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(() => loadPortfolioData())
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [editingQdf, setEditingQdf] = useState<QdfConstituent | null>(null)
  const [suggestedPurchase, setSuggestedPurchase] = useState<{ assetClass: AssetClass; amount: number } | null>(null)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [isPdfImporting, setIsPdfImporting] = useState(false)
  const [storageDirectory, setStorageDirectory] = useState<string | null>(() => getPortfolioStorageDirectory())
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null)
  const [isUpdateActionLoading, setIsUpdateActionLoading] = useState(false)
  const snapshot = portfolioData ? calculatePortfolio(portfolioData) : null
  const portfolioIssues = portfolioData ? validatePortfolio(portfolioData) : []
  const overviewAllocation = snapshot ? toAllocationDisplay(snapshot) : []
  const overviewPositions = snapshot ? toPositionDisplay(snapshot) : []
  const overviewPerformance = (portfolioData?.history?.length ?? 0) > 0
    ? (portfolioData?.history ?? []).map((point) => ({ date: new Date(point.recordedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }), value: point.totalValue }))
    : snapshot
      ? [{ date: 'Aujourd’hui', value: snapshot.totalValue }]
      : []

  const initializePortfolio = () => {
    const data = recordPortfolioHistory(portfolioData ?? createLocalPortfolio())
    savePortfolioData(data)
    setPortfolioData(data)
    return data
  }

  const persistPortfolio = (data: PortfolioData) => {
    const nextData = recordPortfolioHistory(data)
    savePortfolioData(nextData)
    setPortfolioData(nextData)
  }

  const startTransaction = () => {
    initializePortfolio()
    setEditingTransaction(null)
    setSuggestedPurchase(null)
    setIsTransactionDialogOpen(true)
  }

  const prepareSuggestedPurchase = (assetClass: AssetClass, amount: number) => {
    if (amount <= 0) return
    initializePortfolio()
    setEditingTransaction(null)
    setSuggestedPurchase({ assetClass, amount })
    setIsTransactionDialogOpen(true)
  }

  const addManualTransaction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const currentData = portfolioData ?? initializePortfolio()
    const form = new FormData(event.currentTarget)
    const kind = form.get('kind') as TransactionKind
    const quantity = positiveNumber(form.get('quantity'))
    const unitPrice = positiveNumber(form.get('unitPrice'))
    const providedGrossAmount = positiveNumber(form.get('grossAmount'))
    const isSecurity = kind === 'Achat' || kind === 'Vente'
    const grossAmount = providedGrossAmount
      ?? (quantity && unitPrice ? quantity * unitPrice : undefined)
      ?? (!isSecurity ? unitPrice : undefined)
    const fees = positiveNumber(form.get('fees')) ?? 0
    if (!grossAmount || (isSecurity && !quantity)) return
    const transaction: Transaction = { id: editingTransaction?.id ?? `manual-${crypto.randomUUID()}`, occurredOn: String(form.get('occurredOn')), kind, instrumentName: String(form.get('instrumentName')).trim(), ticker: optionalFormText(form.get('ticker')), isin: optionalFormText(form.get('isin')), quantity, unitPrice, grossAmount, fees, cashFlow: calculateManualCashFlow(kind, grossAmount, fees), assetClass: form.get('assetClass') as AssetClass, note: optionalFormText(form.get('note')) }
    const updatedTransactions = editingTransaction ? currentData.transactions.map((candidate) => candidate.id === transaction.id ? transaction : candidate) : [...currentData.transactions, transaction]
    const nextData = addAuditEntry({ ...currentData, transactions: updatedTransactions }, { action: editingTransaction ? 'update' : 'create', detail: `${editingTransaction ? 'Correction' : 'Ajout'} de l’opération ${transaction.instrumentName}`, transactionId: transaction.id })
    persistPortfolio(nextData)
    setIsTransactionDialogOpen(false)
    setEditingTransaction(null)
    setActive('Journal des transactions')
  }

  const editTransaction = (transaction: Transaction) => { setEditingTransaction(transaction); setIsTransactionDialogOpen(true) }
  const duplicateTransaction = (transaction: Transaction) => {
    const currentData = portfolioData ?? initializePortfolio()
    const copy = { ...transaction, id: `manual-${crypto.randomUUID()}`, occurredOn: new Date().toISOString().slice(0, 10), cancelledAt: undefined, cancellationReason: undefined, note: transaction.note ? `${transaction.note} · Dupliquée` : 'Dupliquée depuis le journal' }
    persistPortfolio(addAuditEntry({ ...currentData, transactions: [...currentData.transactions, copy] }, { action: 'create', detail: `Duplication de l’opération ${copy.instrumentName}`, transactionId: copy.id }))
  }
  const cancelTransaction = (transaction: Transaction) => {
    if (!portfolioData || transaction.cancelledAt) return
    const nextData = addAuditEntry({ ...portfolioData, transactions: portfolioData.transactions.map((candidate) => candidate.id === transaction.id ? { ...candidate, cancelledAt: new Date().toISOString(), cancellationReason: 'Annulée depuis le journal local' } : candidate) }, { action: 'cancel', detail: `Annulation de l’opération ${transaction.instrumentName}`, transactionId: transaction.id })
    persistPortfolio(nextData)
  }
  const saveMarketPrice = (instrumentId: string, price: number) => {
    if (!portfolioData || !Number.isFinite(price) || price <= 0) return
    const nextData = addAuditEntry({ ...portfolioData, marketPrices: { ...portfolioData.marketPrices, [instrumentId]: { value: price, updatedAt: new Date().toISOString() } } }, { action: 'price', detail: `Mise à jour du cours de ${instrumentId}`, transactionId: instrumentId })
    persistPortfolio(nextData)
  }
  const saveQdfConstituent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const currentData = portfolioData ?? initializePortfolio()
    const form = new FormData(event.currentTarget)
    const ticker = String(form.get('ticker')).trim().toUpperCase()
    const company = String(form.get('company')).trim()
    const targetWeight = Number(form.get('targetWeight')) / 100
    if (!ticker || !company || !Number.isFinite(targetWeight) || targetWeight < 0) return
    const constituent: QdfConstituent = { status: 'Actif', rank: positiveNumber(form.get('rank')), company, ticker, isin: optionalFormText(form.get('isin')), sector: optionalFormText(form.get('sector')), targetWeight, note: optionalFormText(form.get('note')) }
    const constituents = editingQdf ? currentData.qdfConstituents.map((item) => item.ticker === editingQdf.ticker ? { ...item, ...constituent } : item) : [...currentData.qdfConstituents, constituent]
    persistPortfolio(addAuditEntry({ ...currentData, qdfConstituents: constituents }, { action: editingQdf ? 'update' : 'create', detail: `${editingQdf ? 'Mise à jour' : 'Ajout'} du constituant QDF ${ticker}` }))
    setEditingQdf(null)
  }

  const importIgOrdersFromPaste = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const currentData = portfolioData ?? initializePortfolio()
    const form = new FormData(event.currentTarget)
    const raw = String(form.get('igPaste') ?? '').trim()
    const fallbackAssetClass = String(form.get('fallbackAssetClass') ?? 'Non classé') as AssetClass
    if (!raw) {
      setImportMessage('Collez d’abord le tableau IG (onglet Exécutés).')
      return
    }

    const parsedRows = parseIgExecutedOrdersPaste(raw)
    if (parsedRows.length === 0) {
      setImportMessage('Aucune ligne exploitable détectée. Copiez les lignes du tableau IG incluant les colonnes Entreprise, Quantité, Type et prix, Exécuté.')
      return
    }

    const existingFingerprints = new Set(currentData.transactions.map((transaction) => `${transaction.occurredOn}|${transaction.kind}|${transaction.instrumentName}|${transaction.quantity ?? 0}|${transaction.grossAmount}`))
    const importedTransactions = parsedRows
      .map((row) => {
        const assetClass = inferAssetClassFromName(row.instrumentName, fallbackAssetClass, row.isin)
        const grossAmount = row.grossAmount
        const quantity = row.quantity
        const unitPrice = row.unitPrice ?? (quantity > 0 ? grossAmount / quantity : undefined)
        const kind: TransactionKind = row.kind
        return {
          id: `manual-${crypto.randomUUID()}`,
          occurredOn: row.occurredOn,
          kind,
          instrumentName: row.instrumentName,
          quantity,
          unitPrice,
          grossAmount,
          fees: 0,
          cashFlow: calculateManualCashFlow(kind, grossAmount, 0),
          assetClass,
          note: 'Import IG par collage',
        } as Transaction
      })
      .filter((transaction) => {
        const fingerprint = `${transaction.occurredOn}|${transaction.kind}|${transaction.instrumentName}|${transaction.quantity ?? 0}|${transaction.grossAmount}`
        if (existingFingerprints.has(fingerprint)) return false
        existingFingerprints.add(fingerprint)
        return true
      })

    if (importedTransactions.length === 0) {
      setImportMessage('Les lignes collées existent déjà dans le journal local.')
      return
    }

    const netCashFlow = importedTransactions.reduce((sum, transaction) => sum + transaction.cashFlow, 0)
    const transactionsToAppend = [...importedTransactions]
    if (netCashFlow < 0) {
      transactionsToAppend.push({
        id: `manual-${crypto.randomUUID()}`,
        occurredOn: importedTransactions[0]?.occurredOn ?? new Date().toISOString().slice(0, 10),
        kind: 'Dépôt',
        instrumentName: 'Alimentation cash (auto import IG)',
        grossAmount: Math.abs(netCashFlow),
        fees: 0,
        cashFlow: Math.abs(netCashFlow),
        assetClass: 'Liquidités',
        note: 'Ajustement automatique pour refléter un portefeuille valorisable sans historique des dépôts IG.',
      })
    }

    const nextData = addAuditEntry({ ...currentData, transactions: [...currentData.transactions, ...transactionsToAppend] }, { action: 'create', detail: `Import IG par collage: ${importedTransactions.length} opération(s)` })
    persistPortfolio(nextData)
    setImportMessage(`${importedTransactions.length} opération(s) importée(s)${netCashFlow < 0 ? ' + dépôt auto de compensation cash' : ''}.`)
    setActive('Journal des transactions')
  }

  const importIgPricesFromPaste = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const currentData = portfolioData ?? initializePortfolio()
    const form = new FormData(event.currentTarget)
    const raw = String(form.get('igPricesPaste') ?? '').trim()
    if (!raw) {
      setImportMessage('Collez d’abord le tableau IG Vos avoirs.')
      return
    }

    const rows = parseIgHoldingsPaste(raw)
    if (rows.length === 0) {
      setImportMessage('Aucun cours détecté. Copiez les lignes du tableau Vos avoirs incluant Titres et Prix actuel.')
      return
    }

    const snapshot = calculatePortfolio(currentData)
    const candidatePositions = [
      ...snapshot.positions.filter((position) => position.id !== 'QDF'),
      ...calculateQdfHoldings(currentData),
    ]
    const updates: Record<string, { value: number; updatedAt: string }> = { ...(currentData.marketPrices ?? {}) }
    let updatedCount = 0
    let unmatchedCount = 0

    for (const row of rows) {
      const position = findPositionForHoldingRow(candidatePositions, row)
      if (!position) {
        unmatchedCount += 1
        continue
      }
      updates[position.id] = { value: row.marketPrice, updatedAt: new Date().toISOString() }
      updatedCount += 1
    }

    if (updatedCount === 0) {
      setImportMessage('Aucun instrument du collage ne correspond aux positions locales.')
      return
    }

    const nextData = addAuditEntry({ ...currentData, marketPrices: updates }, { action: 'price', detail: `Import IG des cours: ${updatedCount} cours mis à jour${unmatchedCount ? `, ${unmatchedCount} ligne(s) non appariée(s)` : ''}` })
    persistPortfolio(nextData)
    setImportMessage(`${updatedCount} cours mis à jour${unmatchedCount ? ` · ${unmatchedCount} ligne(s) ignorée(s)` : ''}.`)
    setActive('Cours')
  }

  const importIgCashHistoryFromPaste = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const currentData = portfolioData ?? initializePortfolio()
    const form = new FormData(event.currentTarget)
    const raw = String(form.get('igCashPaste') ?? '').trim()
    if (!raw) {
      setImportMessage('Collez d’abord l’historique de trésorerie IG.')
      return
    }

    const rows = parseIgCashHistoryPaste(raw)
    const depositRows = rows.filter((row) => row.kind === 'Dépôt' && row.amount > 0)
    if (depositRows.length === 0) {
      setImportMessage('Aucun dépôt exploitable détecté dans l’historique collé.')
      return
    }

    const existingFingerprints = new Set(currentData.transactions.map((transaction) => `${transaction.occurredOn}|${transaction.kind}|${transaction.grossAmount}|${transaction.instrumentName}`))
    const depositsToImport: Transaction[] = []
    for (const row of depositRows) {
      const transaction: Transaction = {
        id: `manual-${crypto.randomUUID()}`,
        occurredOn: row.occurredOn,
        kind: 'Dépôt',
        instrumentName: 'Dépôt IG (historique trésorerie)',
        grossAmount: row.amount,
        fees: 0,
        cashFlow: row.amount,
        assetClass: 'Liquidités',
        note: 'Import historique trésorerie IG',
      }
      const fingerprint = `${transaction.occurredOn}|${transaction.kind}|${transaction.grossAmount}|${transaction.instrumentName}`
      if (existingFingerprints.has(fingerprint)) continue
      existingFingerprints.add(fingerprint)
      depositsToImport.push(transaction)
    }

    if (depositsToImport.length === 0) {
      setImportMessage('Les dépôts de cet historique sont déjà présents.')
      return
    }

    const nextData = addAuditEntry({ ...currentData, transactions: [...currentData.transactions, ...depositsToImport] }, { action: 'create', detail: `Import historique trésorerie IG: ${depositsToImport.length} dépôt(s)` })
    persistPortfolio(nextData)
    setImportMessage(`${depositsToImport.length} dépôt(s) importé(s) depuis l’historique de trésorerie IG.`)
    setActive('Rééquilibrage')
  }

  const importIgStatementsFromPdf = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const currentData = portfolioData ?? initializePortfolio()
    const form = new FormData(formElement)
    const fallbackAssetClass = String(form.get('fallbackAssetClass') ?? 'ETF Maison') as AssetClass
    const files = form.getAll('statementPdfs').filter((entry): entry is File => entry instanceof File && entry.size > 0)
    const uniqueFiles = Array.from(new Map(files.map((file) => [`${file.name}|${file.size}`, file] as const)).values())

    if (uniqueFiles.length === 0) {
      setImportMessage('Sélectionnez au moins un relevé PDF IG.')
      return
    }

    setIsPdfImporting(true)

    try {
      const parsedOrders: Array<{ instrumentName: string; isin?: string; quantity: number; grossAmount: number; unitPrice?: number; occurredOn: string; kind: TransactionKind }> = []
      const parsedCashRows: Array<{ kind: 'Dépôt' | 'Retrait'; amount: number; occurredOn: string }> = []
      let unreadableFiles = 0
      let ignoredFiles = 0
      let duplicateRows = 0
      const typeCounters: Record<'QUARTERLY' | 'ACCOUNT_OPENING' | 'ORDER_EX_ANTE_COST' | 'CANCELLED_ORDER' | 'BUY_ORDER' | 'SELL_ORDER' | 'UNKNOWN', number> = {
        QUARTERLY: 0,
        ACCOUNT_OPENING: 0,
        ORDER_EX_ANTE_COST: 0,
        CANCELLED_ORDER: 0,
        BUY_ORDER: 0,
        SELL_ORDER: 0,
        UNKNOWN: 0,
      }

      for (const file of uniqueFiles) {
        const fileType = detectIgPdfType(file.name)
        typeCounters[fileType] += 1

        try {
          const text = await extractTextFromPdfFile(file)

          if (fileType === 'ORDER_EX_ANTE_COST' || fileType === 'CANCELLED_ORDER') {
            const fromBuyStatement = parseIgOrderStatementPdfText(text, 'Achat')
            const fromSellStatement = parseIgOrderStatementPdfText(text, 'Vente')
            const fallbackOrders = [...fromBuyStatement, ...fromSellStatement]

            if (fallbackOrders.length === 0) {
              ignoredFiles += 1
              continue
            }

            parsedOrders.push(...fallbackOrders)
            continue
          }

          if (fileType === 'BUY_ORDER' || fileType === 'SELL_ORDER') {
            const fromStatement = parseIgOrderStatementPdfText(text, fileType === 'SELL_ORDER' ? 'Vente' : 'Achat')
            parsedOrders.push(...fromStatement)
            continue
          }

          if (fileType === 'ACCOUNT_OPENING') {
            parsedCashRows.push(...parseIgCashHistoryPaste(text))
            continue
          }

          parsedOrders.push(...parseIgExecutedOrdersPaste(text))
          parsedCashRows.push(...parseIgCashHistoryPaste(text))
        } catch {
          unreadableFiles += 1
        }
      }

      const existingFingerprints = new Set(currentData.transactions.map((transaction) => `${transaction.occurredOn}|${transaction.kind}|${transaction.instrumentName}|${transaction.quantity ?? 0}|${transaction.grossAmount}`))
      const transactionsToAppend: Transaction[] = []

      for (const row of parsedOrders) {
        const assetClass = inferAssetClassFromName(row.instrumentName, fallbackAssetClass, row.isin)
        const quantity = row.quantity
        const grossAmount = row.grossAmount
        const unitPrice = row.unitPrice ?? (quantity > 0 ? grossAmount / quantity : undefined)

        const transaction: Transaction = {
          id: `manual-${crypto.randomUUID()}`,
          occurredOn: row.occurredOn,
          kind: row.kind,
          instrumentName: row.instrumentName,
          isin: row.isin,
          quantity,
          unitPrice,
          grossAmount,
          fees: 0,
          cashFlow: calculateManualCashFlow(row.kind, grossAmount, 0),
          assetClass,
          note: 'Import relevé PDF IG',
        }

        const fingerprint = `${transaction.occurredOn}|${transaction.kind}|${transaction.instrumentName}|${transaction.quantity ?? 0}|${transaction.grossAmount}`
        if (existingFingerprints.has(fingerprint)) {
          duplicateRows += 1
          continue
        }
        existingFingerprints.add(fingerprint)
        transactionsToAppend.push(transaction)
      }

      for (const row of parsedCashRows) {
        const isDeposit = row.kind === 'Dépôt'
        const grossAmount = row.amount
        const transaction: Transaction = {
          id: `manual-${crypto.randomUUID()}`,
          occurredOn: row.occurredOn,
          kind: isDeposit ? 'Dépôt' : 'Autre',
          instrumentName: isDeposit ? 'Dépôt IG (relevé PDF)' : 'Retrait IG (relevé PDF)',
          grossAmount,
          fees: 0,
          cashFlow: isDeposit ? grossAmount : -grossAmount,
          assetClass: 'Liquidités',
          note: 'Import relevé PDF IG',
        }

        const fingerprint = `${transaction.occurredOn}|${transaction.kind}|${transaction.instrumentName}|0|${transaction.grossAmount}`
        if (existingFingerprints.has(fingerprint)) {
          duplicateRows += 1
          continue
        }
        existingFingerprints.add(fingerprint)
        transactionsToAppend.push(transaction)
      }

      if (transactionsToAppend.length === 0) {
        const detectedRows = parsedOrders.length + parsedCashRows.length
        if (detectedRows > 0 && duplicateRows > 0) {
          setImportMessage(`Aucune nouvelle transaction: ${duplicateRows} ligne(s) détectée(s) sont déjà présentes. PDF analysés: ${uniqueFiles.length}${ignoredFiles ? `, ${ignoredFiles} ignoré(s) (Ex Ante / Ordre annulé)` : ''}${unreadableFiles ? `, ${unreadableFiles} illisible(s)` : ''}.`)
        } else {
          setImportMessage(`Aucune nouvelle transaction détectée. PDF analysés: ${uniqueFiles.length}${ignoredFiles ? `, ${ignoredFiles} ignoré(s) (Ex Ante / Ordre annulé)` : ''}${unreadableFiles ? `, ${unreadableFiles} illisible(s)` : ''}.`)
        }
        return
      }

      const typeSummary = [
        typeCounters.QUARTERLY ? `${typeCounters.QUARTERLY} trimestriel(s)` : null,
        typeCounters.ACCOUNT_OPENING ? `${typeCounters.ACCOUNT_OPENING} ouverture(s)` : null,
        typeCounters.BUY_ORDER ? `${typeCounters.BUY_ORDER} achat(s)` : null,
        typeCounters.SELL_ORDER ? `${typeCounters.SELL_ORDER} vente(s)` : null,
        typeCounters.ORDER_EX_ANTE_COST ? `${typeCounters.ORDER_EX_ANTE_COST} ex-ante` : null,
        typeCounters.CANCELLED_ORDER ? `${typeCounters.CANCELLED_ORDER} ordre(s) annulé(s)` : null,
        typeCounters.UNKNOWN ? `${typeCounters.UNKNOWN} inconnu(s)` : null,
      ].filter(Boolean).join(', ')

      const nextData = addAuditEntry(
        { ...currentData, transactions: [...currentData.transactions, ...transactionsToAppend] },
        {
          action: 'create',
          detail: `Import relevés PDF IG: ${transactionsToAppend.length} transaction(s) depuis ${uniqueFiles.length} fichier(s)${ignoredFiles ? `, ${ignoredFiles} ignoré(s)` : ''}${unreadableFiles ? `, ${unreadableFiles} illisible(s)` : ''}${typeSummary ? ` · Types: ${typeSummary}` : ''}`,
        },
      )
      persistPortfolio(normalizePortfolioData(nextData))
      setImportMessage(`${transactionsToAppend.length} transaction(s) importée(s) depuis ${uniqueFiles.length} PDF${ignoredFiles ? ` · ${ignoredFiles} ignoré(s) (Ex Ante / Ordre annulé)` : ''}${unreadableFiles ? ` · ${unreadableFiles} non lisible(s)` : ''}${typeSummary ? ` · ${typeSummary}` : ''}.`)
      setActive('Journal des transactions')
      formElement.reset()
    } finally {
      setIsPdfImporting(false)
    }
  }

  const resetLocalPortfolio = () => {
    if (isDesktopRuntime()) {
      window.desktopAPI?.clearPortfolioDataSync()
    } else {
      window.localStorage.removeItem('ig-portefeuille-data')
    }
    setPortfolioData(null)
    setImportMessage('Données locales supprimées. Portefeuille réinitialisé.')
    setBackupMessage(null)
    setSettingsMessage(null)
    setStorageDirectory(getPortfolioStorageDirectory())
    setActive('Données locales')
  }

  const chooseStorageDirectory = async () => {
    if (!isDesktopRuntime()) return
    const selected = await window.desktopAPI?.chooseDataDirectory()
    if (!selected) return
    setStorageDirectory(selected)
    if (portfolioData) savePortfolioData(portfolioData)
    setImportMessage(`Dossier de données configuré: ${selected}`)
  }

  const createBackup = () => {
    if (!portfolioData) {
      setBackupMessage('Aucune donnée locale à sauvegarder pour le moment.')
      return
    }

    downloadPortfolioBackup(portfolioData)
    setBackupMessage('Sauvegarde créée et téléchargée localement.')
  }

  const refreshDesktopUpdateState = async () => {
    if (!isDesktopRuntime()) return
    const state = await window.desktopAPI?.getUpdateState()
    if (state) setDesktopUpdateState(state)
  }

  useEffect(() => {
    if (!isDesktopRuntime()) return

    void refreshDesktopUpdateState()
    const timer = window.setInterval(() => {
      void refreshDesktopUpdateState()
    }, 1500)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const checkForDesktopUpdates = async () => {
    if (!isDesktopRuntime()) return
    setIsUpdateActionLoading(true)
    try {
      const nextState = await window.desktopAPI?.checkForUpdates()
      if (nextState) setDesktopUpdateState(nextState)
    } finally {
      setIsUpdateActionLoading(false)
    }
  }

  const downloadDesktopUpdate = async () => {
    if (!isDesktopRuntime()) return
    setIsUpdateActionLoading(true)
    try {
      const nextState = await window.desktopAPI?.downloadUpdate()
      if (nextState) setDesktopUpdateState(nextState)
    } finally {
      setIsUpdateActionLoading(false)
    }
  }

  const installDesktopUpdate = async () => {
    if (!isDesktopRuntime()) return
    setIsUpdateActionLoading(true)
    try {
      const nextState = await window.desktopAPI?.installDownloadedUpdate()
      if (nextState) setDesktopUpdateState(nextState)
    } finally {
      setIsUpdateActionLoading(false)
    }
  }
  const disableQdfConstituent = (ticker: string) => {
    if (!portfolioData) return
    persistPortfolio(addAuditEntry({ ...portfolioData, qdfConstituents: portfolioData.qdfConstituents.map((item) => item.ticker === ticker ? { ...item, status: 'Inactif' } : item) }, { action: 'update', detail: `Désactivation du constituant QDF ${ticker}` }))
  }
  const saveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const targetClasses: AssetClass[] = ['ETF Monde', 'ETF Small Caps', 'Actions individuelles', 'ETF Maison']
    const targets = targetClasses.map((assetClass) => ({ assetClass, targetWeight: Number(form.get(assetClass)) / 100 }))
    const minimumCashWeight = Number(form.get('minimumCashWeight')) / 100
    const minimumOrderAmount = Number(form.get('minimumOrderAmount'))
    const targetIndividualStockCount = Number(form.get('targetIndividualStockCount'))
    if ([...targets.map((target) => target.targetWeight), minimumCashWeight, minimumOrderAmount, targetIndividualStockCount].some((value) => !Number.isFinite(value) || value < 0)) {
      setSettingsMessage('Les paramètres doivent être des nombres positifs.')
      return
    }
    if (Math.abs(targets.reduce((sum, target) => sum + target.targetWeight, 0) + minimumCashWeight - 1) > 0.0001) {
      setSettingsMessage('Les cibles d’allocation, liquidités incluses, doivent totaliser 100 %.')
      return
    }
    const currentData = portfolioData ?? initializePortfolio()
    const nextData = addAuditEntry({ ...currentData, allocationTargets: targets, rebalancingRules: { minimumCashWeight, minimumOrderAmount, targetIndividualStockCount } }, { action: 'update', detail: 'Mise à jour des paramètres de gestion' })
    persistPortfolio(nextData)
    setSettingsMessage('Paramètres enregistrés localement.')
  }
  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as { data?: unknown }
      const data = parsed.data
      if (!isPortfolioData(data)) throw new Error('Format de sauvegarde non reconnu.')
      const restored = addAuditEntry({ ...data, createdAt: data.createdAt || new Date().toISOString(), marketPrices: data.marketPrices ?? {} }, { action: 'update', detail: `Restauration locale depuis ${file.name}` })
      persistPortfolio(restored)
      setBackupMessage(`Sauvegarde restaurée : ${file.name}`)
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'La sauvegarde n’a pas pu être restaurée.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><LineChart size={19} /></div>
          <div><strong>Portefeuille</strong><span>IG · Compte-titres</span></div>
        </div>

        <nav aria-label="Navigation principale">
          <NavItem icon={<LayoutDashboard size={18} />} label="Vue d’ensemble" active={active} onClick={setActive} />
          <NavItem icon={<BriefcaseBusiness size={18} />} label="Positions" active={active} onClick={setActive} />
          <NavItem icon={<RefreshCw size={18} />} label="Cours" active={active} onClick={setActive} />
          <NavItem icon={<Layers3 size={18} />} label="Gestion QDF" active={active} onClick={setActive} />
          <NavItem icon={<ReceiptText size={18} />} label="Journal des transactions" active={active} onClick={setActive} />
          <NavItem icon={<Sparkles size={18} />} label="Rééquilibrage" active={active} onClick={setActive} />
          <NavItem icon={<BarChart3 size={18} />} label="Historique" active={active} onClick={setActive} />
          <NavItem icon={<ShieldCheck size={18} />} label="Contrôles" active={active} onClick={setActive} />
        </nav>

        <div className="sidebar-bottom">
          <NavItem icon={<Database size={17} />} label="Données locales" active={active} onClick={setActive} subtle />
          <NavItem icon={<Settings size={17} />} label="Paramètres" active={active} onClick={setActive} subtle />
          <div className="sync-state"><span className="pulse" /> Mode local</div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{active}</p>
            <h1>{pageTitles[active]}</h1>
          </div>
          <div className="topbar-actions">
            <span className="updated">{snapshot ? 'Données locales à jour' : 'Portefeuille à initialiser'}</span>
            <button className="button primary" onClick={startTransaction}><Plus size={17} /> Ajouter une opération</button>
          </div>
        </header>

        {active === 'Vue d’ensemble' && <>
        <section className="hero-grid">
          <article className="card balance-card">
            <div className="card-label"><Wallet size={16} /> Valeur du portefeuille</div>
            <div className="balance">{euro(snapshot?.totalValue ?? 0)}</div>
            <div className={`gain ${snapshot && snapshot.unrealizedGainLoss < 0 ? 'negative' : ''}`}><ArrowUpRight size={16} /> <strong>{snapshot ? signedEuro(snapshot.unrealizedGainLoss) : signedEuro(0)}</strong> gain latent <span>{snapshot ? formatPercent(snapshot.totalCostBasis === 0 ? 0 : snapshot.unrealizedGainLoss / snapshot.totalCostBasis) : formatPercent(0)}</span></div>
            <div className="balance-foot"><span>Coût de revient <strong>{snapshot ? euro(snapshot.totalCostBasis) : euro(0)}</strong></span><span>Liquidités <strong>{snapshot ? euro(snapshot.cash) : euro(0)}</strong></span></div>
          </article>

          <article className="card chart-card">
            <div className="card-heading"><div><span className="card-label">Évolution</span><strong>Historique local</strong></div><button className="icon-button"><MoreHorizontal size={19} /></button></div>
            {overviewPerformance.length > 0 ? <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={overviewPerformance} margin={{ top: 8, right: 0, bottom: 0, left: -28 }}>
                  <defs><linearGradient id="portfolioFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#7c9cff" stopOpacity={0.3} /><stop offset="100%" stopColor="#7c9cff" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: '#737b91', fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: '#737b91', fontSize: 11 }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: '#1a1e29', border: '1px solid #2b3141', borderRadius: 10 }} labelStyle={{ color: '#aab2c5' }} formatter={(value) => [euro(Number(value)), 'Valeur']} />
                  <Area type="monotone" dataKey="value" stroke="#8ca8ff" strokeWidth={2.5} fill="url(#portfolioFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div> : <div className="empty-journal"><BarChart3 size={24} /><strong>Aucun historique</strong><p>Importez des relevés PDF ou ajoutez une opération pour créer des points d’évolution.</p></div>}
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="card allocation-card">
            <div className="card-heading"><div><span className="card-label">Allocation</span><strong>Répartition actuelle</strong></div><button className="text-button" onClick={() => setActive('Rééquilibrage')}>Voir le détail</button></div>
            <div className="allocation-body">
              <div className="donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={overviewAllocation} dataKey="value" innerRadius={58} outerRadius={78} paddingAngle={3} stroke="none">{overviewAllocation.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip contentStyle={{ background: '#1a1e29', border: '1px solid #2b3141', borderRadius: 10 }} formatter={(value) => [`${value} %`, 'Poids']} /></PieChart></ResponsiveContainer><div className="donut-label"><strong>{overviewAllocation.length}</strong><span>poches</span></div></div>
              <div className="legend">{overviewAllocation.map((item) => <div className="legend-row" key={item.name}><span className="legend-name"><i style={{ background: item.color }} />{item.name}</span><span><b>{item.value.toFixed(1).replace('.', ',')} %</b><small>Cible {item.target} %</small></span></div>)}</div>
            </div>
          </article>

          <article className="card insight-card">
            <div className="card-heading"><div><span className="card-label">À surveiller</span><strong>Prochaines actions</strong></div><CircleHelp size={17} className="muted" /></div>
            <div className="insight-list">
              <div className="insight"><div className="insight-icon purple"><Sparkles size={17} /></div><div><strong>QDF est sous sa cible</strong><p>{snapshot ? `Il manque ${euro(snapshot.rebalancing.find((item) => item.assetClass === 'ETF Maison')?.deficit ?? 0)} pour atteindre sa cible.` : 'Importez vos relevés PDF pour calculer les écarts de cible.'}</p></div><ArrowUpRight size={17} /></div>
              <div className="insight"><div className="insight-icon amber"><Wallet size={17} /></div><div><strong>Réserve cash au-dessus du seuil</strong><p>{snapshot ? `${euro(snapshot.investableCash)} mobilisables après la réserve.` : 'Aucun cash mobilisable tant qu’aucune opération n’est importée.'}</p></div><ArrowUpRight size={17} /></div>
              <div className="insight"><div className="insight-icon green"><RefreshCw size={17} /></div><div><strong>Revue QDF à préparer</strong><p>Prochaine revue complète : 30 septembre.</p></div><ArrowUpRight size={17} /></div>
            </div>
          </article>
        </section>

        <section className="card positions-card">
          <div className="card-heading"><div><span className="card-label">Portefeuille</span><strong>Positions principales</strong></div><button className="text-button" onClick={() => setActive('Positions')}>Toutes les positions</button></div>
          {overviewPositions.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Instrument</th><th>ISIN</th><th>Catégorie</th><th className="align-right">Valeur</th><th className="align-right">Poids</th><th className="align-right">Performance</th><th /></tr></thead><tbody>{overviewPositions.map((position) => <tr key={position.id}><td><div className="instrument"><span className="ticker">{position.ticker}</span><div><strong>{position.name}</strong><small>{position.ticker}</small></div></div></td><td>{position.isin ?? '—'}</td><td><span className="tag">{position.type}</span></td><td className="align-right value">{position.value}</td><td className="align-right">{position.weight}</td><td className={`align-right performance ${position.positive ? 'positive' : 'negative'}`}>{position.positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{position.change}</td><td className="align-right"><button className="icon-button"><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div> : <div className="empty-journal"><BriefcaseBusiness size={24} /><strong>Aucune position</strong><p>Importez vos relevés PDF pour afficher les positions.</p></div>}
        </section>
        </>}

        {active === 'Positions' && <LocalPositionsView snapshot={snapshot} />}
        {active === 'Cours' && <MarketPricesView data={portfolioData} snapshot={snapshot} onSave={saveMarketPrice} />}
        {active === 'Gestion QDF' && <LocalQdfView data={portfolioData} snapshot={snapshot} onSavePrice={saveMarketPrice} onEdit={(item) => setEditingQdf(item)} onDisable={disableQdfConstituent} onAdd={() => setEditingQdf({ status: 'Actif', company: '', ticker: '', targetWeight: 0 })} />}
        {active === 'Journal des transactions' && <TransactionsView data={portfolioData} onEdit={editTransaction} onDuplicate={duplicateTransaction} onCancel={cancelTransaction} />}
        {active === 'Rééquilibrage' && <RebalancingView snapshot={snapshot} onPrepare={prepareSuggestedPurchase} />}
        {active === 'Historique' && <HistoryView data={portfolioData} />}
        {active === 'Contrôles' && <LocalControlsView issues={portfolioIssues} hasData={Boolean(portfolioData)} />}
        {active === 'Données locales' && <PdfStatementsDataView data={portfolioData} importMessage={importMessage} backupMessage={backupMessage} isImporting={isPdfImporting} storageDirectory={storageDirectory} isDesktop={isDesktopRuntime()} onImportPdf={importIgStatementsFromPdf} onReset={resetLocalPortfolio} onChooseStorageDirectory={chooseStorageDirectory} onDownloadBackup={createBackup} onRestoreBackup={restoreBackup} updateState={desktopUpdateState} isUpdateActionLoading={isUpdateActionLoading} onCheckForUpdate={checkForDesktopUpdates} onDownloadUpdate={downloadDesktopUpdate} onInstallUpdate={installDesktopUpdate} />}
        {active === 'Paramètres' && <SettingsView data={portfolioData} onSave={saveSettings} message={settingsMessage} />}
      </section>
      {isTransactionDialogOpen && (editingTransaction ? <EditTransactionDialog transaction={editingTransaction} onClose={() => { setIsTransactionDialogOpen(false); setEditingTransaction(null) }} onSubmit={addManualTransaction} /> : <ManualTransactionDialog suggestedPurchase={suggestedPurchase} onClose={() => { setIsTransactionDialogOpen(false); setEditingTransaction(null); setSuggestedPurchase(null) }} onSubmit={addManualTransaction} />)}
      {editingQdf && <QdfConstituentDialog constituent={editingQdf} onClose={() => setEditingQdf(null)} onSubmit={saveQdfConstituent} />}
    </main>
  )
}

function NavItem({ icon, label, active, onClick, subtle = false }: { icon: ReactNode; label: Navigation; active: Navigation; onClick: (label: Navigation) => void; subtle?: boolean }) {
  return <button className={`${subtle ? 'sidebar-link' : 'nav-item'} ${active === label ? 'active' : ''}`} onClick={() => onClick(label)}>{icon}{label}</button>
}

/* Anciennes vues héritées de l’import Excel, conservées temporairement hors compilation.
function PositionsView({ snapshot }: { snapshot: PortfolioSnapshot | null }) {
  const displayedPositions = snapshot ? toPositionDisplay(snapshot) : positions
  return <section className="card positions-card page-card">
    <div className="card-heading"><div><span className="card-label">Portefeuille</span><strong>{snapshot ? `${snapshot.positions.length} positions · ${euro(snapshot.totalValue - snapshot.cash)} investis` : '5 positions · 572,37 € investis'}</strong></div><button className="button secondary"><Plus size={16} /> Ajouter une position</button></div>
    {snapshot && <p className="page-intro positions-intro">Les valorisations utilisent le dernier prix de transaction importé, sauf pour QDF qui reprend les cours du classeur. Elles seront remplacées par les cours IG lors de la synchronisation en lecture seule.</p>}<div className="table-wrap"><table><thead><tr><th>Instrument</th><th>Catégorie</th><th className="align-right">Valeur</th><th className="align-right">Poids</th><th className="align-right">Performance</th><th /></tr></thead><tbody>{displayedPositions.map((position) => <tr key={position.ticker}><td><div className="instrument"><span className="ticker">{position.ticker}</span><div><strong>{position.name}</strong><small>{position.ticker}</small></div></div></td><td><span className="tag">{position.type}</span></td><td className="align-right value">{position.value}</td><td className="align-right">{position.weight}</td><td className={`align-right performance ${position.positive ? 'positive' : 'negative'}`}>{position.positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{position.change}</td><td className="align-right"><button className="icon-button"><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>
  </section>
}

function QdfManagementView({ data, snapshot }: { data: PortfolioData | null; snapshot: PortfolioSnapshot | null }) {
  if (!data) return <section className="card page-card"><div className="empty-journal"><Layers3 size={24} /><strong>La poche QDF est prête à être suivie</strong><p>Importez votre classeur Excel pour afficher les lignes, les poids cibles et les cours retenus.</p></div></section>
  const holdings = calculateQdfHoldings(data)
  const qdfPosition = snapshot?.positions.find((position) => position.id === 'QDF')
  const activeConstituents = data.qdfConstituents.filter((constituent) => constituent.status === 'Actif').sort((left, right) => (left.rank ?? 99) - (right.rank ?? 99))
  const qdfValue = qdfPosition?.marketValue ?? 0
  return <section className="page-stack"><div className="metric-grid qdf-metrics"><article className="card metric accent"><span>Valeur de la poche QDF</span><strong>{euro(qdfValue)}</strong><small>{qdfPosition ? `${formatPercent(qdfPosition.gainLossRate)} depuis les achats` : 'aucune ligne achetée'}</small></article><article className="card metric"><span>Lignes actives</span><strong>{activeConstituents.length}</strong><small>dans la sélection importée</small></article><article className="card metric"><span>Poids cible global</span><strong>{formatPercent(data.allocationTargets.find((target) => target.assetClass === 'ETF Maison')?.targetWeight ?? 0)}</strong><small>dans le portefeuille</small></article></div><article className="card positions-card page-card"><div className="card-heading"><div><span className="card-label">Composition</span><strong>Qualité Décotée France</strong></div><span className="tag">Cours du classeur</span></div><p className="page-intro positions-intro">Cette vue agrège les titres de la poche QDF sans les compter séparément dans l’allocation globale. Les cours affichés proviennent de la feuille <b>QDF - Gestion</b>.</p>{activeConstituents.length > 0 ? <div className="table-wrap"><table className="qdf-table"><thead><tr><th>Rang</th><th>Entreprise</th><th>Secteur</th><th className="align-right">Cible QDF</th><th className="align-right">Quantité</th><th className="align-right">Cours retenu</th><th className="align-right">Valeur</th><th>Suivi</th></tr></thead><tbody>{activeConstituents.map((constituent) => { const holding = holdings.find((position) => position.ticker === constituent.ticker); return <tr key={constituent.ticker}><td><span className="qdf-rank">{constituent.rank ?? '—'}</span></td><td><div className="transaction-instrument"><strong>{constituent.company}</strong><small>{constituent.ticker}</small></div></td><td>{constituent.sector ?? '—'}</td><td className="align-right value">{formatPercent(constituent.targetWeight)}</td><td className="align-right">{holding ? holding.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 4 }) : '—'}</td><td className="align-right value">{constituent.marketPrice ? euro(constituent.marketPrice) : 'Manquant'}</td><td className="align-right value">{holding ? euro(holding.marketValue) : '—'}</td><td>{constituent.note ? <span className="qdf-note">{constituent.note}</span> : <span className="tag">À jour</span>}</td></tr> })}</tbody></table></div> : <div className="empty-journal"><Layers3 size={24} /><strong>Aucune ligne QDF active</strong><p>Vérifiez la feuille QDF - Gestion dans le classeur importé.</p></div>}</article></section>
}

*/
function TransactionsView({ data, onEdit, onDuplicate, onCancel }: { data: PortfolioData | null; onEdit: (transaction: Transaction) => void; onDuplicate: (transaction: Transaction) => void; onCancel: (transaction: Transaction) => void }) {
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'Toutes' | TransactionKind>('Toutes')
  const transactions = data?.transactions ?? []
  const orderedTransactions = [...transactions].filter((transaction) => (kindFilter === 'Toutes' || transaction.kind === kindFilter) && `${transaction.instrumentName} ${transaction.ticker ?? ''} ${transaction.isin ?? ''}`.toLowerCase().includes(query.toLowerCase())).sort((left, right) => right.occurredOn.localeCompare(left.occurredOn))
  const totalContributions = transactions.filter((transaction) => transaction.kind === 'Dépôt').reduce((total, transaction) => total + transaction.cashFlow, 0)
  const totalFees = transactions.reduce((total, transaction) => total + transaction.fees, 0)

  return <section className="page-stack"><div className="metric-grid transaction-metrics"><article className="card metric"><span>Mouvements enregistrés</span><strong>{transactions.length}</strong><small>{transactions.filter((transaction) => transaction.cancelledAt).length} annulée(s) conservée(s) à l’audit</small></article><article className="card metric"><span>Versements cumulés</span><strong>{euro(totalContributions)}</strong><small>dépôts enregistrés</small></article><article className="card metric"><span>Frais & taxes</span><strong>{euro(totalFees)}</strong><small>toutes opérations confondues</small></article></div><article className="card positions-card page-card"><div className="card-heading"><div><span className="card-label">Grand livre</span><strong>Tous les mouvements</strong></div><div className="inline-actions">{data && <><button className="button secondary" onClick={() => downloadTransactionsCsv(data)}>CSV</button><button className="button secondary" onClick={() => downloadPortfolioWorkbook(data)}>Excel</button></>}<span className="tag">{orderedTransactions.length} affichée{orderedTransactions.length > 1 ? 's' : ''}</span></div></div><div className="inline-actions"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un instrument, ticker ou ISIN" aria-label="Rechercher dans le journal" /><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as 'Toutes' | TransactionKind)} aria-label="Filtrer par type"><option>Toutes</option><option>Achat</option><option>Vente</option><option>Dépôt</option><option>Dividende</option><option>Frais</option><option>Autre</option></select></div>{orderedTransactions.length > 0 ? <div className="table-wrap"><table className="transactions-table"><thead><tr><th>Date</th><th>Type</th><th>Instrument</th><th>Classe</th><th className="align-right">Montant</th><th className="align-right">Frais</th><th className="align-right">Flux</th><th /></tr></thead><tbody>{orderedTransactions.map((transaction) => <tr className={transaction.cancelledAt ? 'cancelled-row' : ''} key={transaction.id}><td className="transaction-date">{formatDate(transaction.occurredOn)}</td><td><span className={`transaction-kind ${transaction.kind.toLowerCase()}`}>{transaction.kind}</span>{transaction.cancelledAt && <small className="cancelled-label">Annulée</small>}</td><td><div className="transaction-instrument"><strong>{transaction.instrumentName}</strong>{transaction.ticker && <small>{transaction.ticker}{transaction.isin ? ` · ${transaction.isin}` : ''}</small>}</div></td><td><span className="tag">{transaction.assetClass}</span></td><td className="align-right value">{euro(transaction.grossAmount)}</td><td className="align-right muted-cell">{transaction.fees > 0 ? euro(transaction.fees) : '—'}</td><td className={`align-right cash-flow ${transaction.cashFlow >= 0 ? 'positive' : 'negative'}`}>{transaction.cashFlow >= 0 ? '+' : '−'}{euro(Math.abs(transaction.cashFlow))}</td><td className="align-right"><button className="text-button" onClick={() => onEdit(transaction)} disabled={Boolean(transaction.cancelledAt)}>Modifier</button><button className="text-button" onClick={() => onDuplicate(transaction)} disabled={Boolean(transaction.cancelledAt)}>Dupliquer</button><button className="text-button danger-button" onClick={() => onCancel(transaction)} disabled={Boolean(transaction.cancelledAt)}>Annuler</button></td></tr>)}</tbody></table></div> : <div className="empty-journal"><ReceiptText size={24} /><strong>Aucune opération correspondante</strong><p>Modifiez les filtres ou ajoutez une opération locale.</p></div>}</article></section>
}

/* Ancienne vue de contrôles des imports Excel.
function ControlsView({ issues, hasData: hasImport }: { issues: ReturnType<typeof validatePortfolio>; hasData: boolean }) {
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return <section className="page-stack"><div className="metric-grid transaction-metrics"><article className="card metric"><span>Statut des données</span><strong className={errors.length ? 'negative' : 'positive'}>{hasImport ? (errors.length ? 'À corriger' : 'Valide') : 'En attente'}</strong><small>{hasImport ? 'après contrôle local' : 'importez un classeur Excel'}</small></article><article className="card metric"><span>Erreurs bloquantes</span><strong className={errors.length ? 'negative' : ''}>{errors.length}</strong><small>à corriger avant IG</small></article><article className="card metric"><span>Avertissements</span><strong>{warnings.length}</strong><small>à examiner avant synchronisation</small></article></div><article className="card page-card"><div className="card-heading"><div><span className="card-label">Audit local</span><strong>Contrôle des opérations importées</strong></div><span className="tag">Lecture seule</span></div><p className="page-intro">Les contrôles détectent les ventes supérieures aux achats, les ISIN manquants, les classes d’actifs contradictoires et une allocation cible incomplète.</p>{!hasImport ? <div className="empty-journal"><ShieldCheck size={24} /><strong>Aucune donnée à contrôler</strong><p>Importez le classeur Excel depuis la page Données & import.</p></div> : issues.length === 0 ? <div className="validation-success"><ShieldCheck size={20} /><div><strong>Aucune anomalie détectée</strong><p>Les données importées sont cohérentes selon les règles actuelles.</p></div></div> : <div className="issue-list">{issues.map((issue) => <div className={`issue ${issue.severity}`} key={issue.id}><div className="issue-icon">{issue.severity === 'error' ? '!' : 'i'}</div><div><strong>{issue.title}</strong><p>{issue.detail}</p></div><span className="tag">{issue.severity === 'error' ? 'Erreur' : 'À vérifier'}</span></div>)}</div>}</article></section>
}

*/
function ManualTransactionDialog({ onClose, onSubmit, suggestedPurchase }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; suggestedPurchase: { assetClass: AssetClass; amount: number } | null }) {
  const today = new Date().toISOString().slice(0, 10)
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="transaction-dialog card" role="dialog" aria-modal="true" aria-labelledby="transaction-title" onMouseDown={(event) => event.stopPropagation()}><div className="card-heading"><div><span className="card-label">Journal local</span><strong id="transaction-title">{suggestedPurchase ? 'Préparer un achat recommandé' : 'Ajouter une opération'}</strong></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">×</button></div><p className="page-intro">Cette opération reste locale à ce navigateur. Elle ne crée aucun ordre auprès d’IG.</p><form className="transaction-form" onSubmit={onSubmit}><label>Date<input name="occurredOn" type="date" defaultValue={today} required /></label><label>Type<select name="kind" defaultValue="Achat"><option>Achat</option><option>Vente</option><option>Dépôt</option><option>Dividende</option><option>Frais</option><option>Autre</option></select></label><label className="form-wide">Instrument<input name="instrumentName" placeholder="Ex. Vanguard FTSE All-World" required /></label><label>Ticker<input name="ticker" placeholder="VWRA" /></label><label>ISIN<input name="isin" placeholder="IE00BK5BQT80" /></label><label>Classe d’actif<select name="assetClass" defaultValue={suggestedPurchase?.assetClass ?? 'ETF Monde'}><option>ETF Monde</option><option>ETF Small Caps</option><option>Actions individuelles</option><option>ETF Maison</option><option>Liquidités</option><option>Non classé</option></select></label><label>Quantité<input name="quantity" type="number" min="0" step="any" placeholder="Optionnel" /></label><label>Prix unitaire (€)<input name="unitPrice" type="number" min="0" step="any" placeholder="Optionnel" /></label><label>Montant brut (€)<input name="grossAmount" type="number" min="0.01" step="any" defaultValue={suggestedPurchase?.amount} placeholder="Ou calculé" /></label><label>Frais (€)<input name="fees" type="number" min="0" step="any" defaultValue="0" /></label><label className="form-wide">Note<input name="note" defaultValue={suggestedPurchase ? 'Suggestion de rééquilibrage' : undefined} placeholder="Motif ou précision (optionnel)" /></label><div className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>Annuler</button><button className="button primary" type="submit">Enregistrer localement</button></div></form></section></div>
}

function EditTransactionDialog({ transaction, onClose, onSubmit }: { transaction: Transaction; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="transaction-dialog card" role="dialog" aria-modal="true" aria-labelledby="edit-transaction-title" onMouseDown={(event) => event.stopPropagation()}><div className="card-heading"><div><span className="card-label">Correction locale</span><strong id="edit-transaction-title">Modifier une opération</strong></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">×</button></div><p className="page-intro">La version précédente reste décrite dans le journal d’audit local.</p><form className="transaction-form" onSubmit={onSubmit}><label>Date<input name="occurredOn" type="date" defaultValue={transaction.occurredOn} required /></label><label>Type<select name="kind" defaultValue={transaction.kind}><option>Achat</option><option>Vente</option><option>Dépôt</option><option>Dividende</option><option>Frais</option><option>Autre</option></select></label><label className="form-wide">Instrument<input name="instrumentName" defaultValue={transaction.instrumentName} required /></label><label>Ticker<input name="ticker" defaultValue={transaction.ticker} /></label><label>ISIN<input name="isin" defaultValue={transaction.isin} /></label><label>Classe d’actif<select name="assetClass" defaultValue={transaction.assetClass}><option>ETF Monde</option><option>ETF Small Caps</option><option>Actions individuelles</option><option>ETF Maison</option><option>Liquidités</option><option>Non classé</option></select></label><label>Quantité<input name="quantity" type="number" min="0" step="any" defaultValue={transaction.quantity} /></label><label>Prix unitaire (€)<input name="unitPrice" type="number" min="0" step="any" defaultValue={transaction.unitPrice} /></label><label>Montant brut (€)<input name="grossAmount" type="number" min="0.01" step="any" defaultValue={transaction.grossAmount} /></label><label>Frais (€)<input name="fees" type="number" min="0" step="any" defaultValue={transaction.fees} /></label><label className="form-wide">Note<input name="note" defaultValue={transaction.note} /></label><div className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>Annuler</button><button className="button primary" type="submit">Enregistrer la correction</button></div></form></section></div>
}

function RebalancingView({ snapshot, onPrepare }: { snapshot: PortfolioSnapshot | null; onPrepare: (assetClass: AssetClass, amount: number) => void }) {
  if (!snapshot) return <section className="card page-card"><div className="empty-journal"><Sparkles size={24} /><strong>Rééquilibrage indisponible</strong><p>Initialisez le portefeuille puis enregistrez des opérations pour obtenir des recommandations.</p></div></section>
  const recommendations = snapshot.rebalancing
  const actionable = recommendations.filter((item) => item.suggestedAmount > 0)
  return <section className="page-stack"><div className="metric-grid"><article className="card metric"><span>Cash disponible</span><strong>{euro(snapshot.cash)}</strong><small>issu des opérations locales</small></article><article className="card metric"><span>Réserve cible</span><strong>{euro(snapshot.cashTarget)}</strong><small>selon les paramètres</small></article><article className="card metric accent"><span>Montant mobilisable</span><strong>{euro(snapshot.investableCash)}</strong><small>après la réserve cash</small></article></div><article className="card page-card"><div className="card-heading"><div><span className="card-label">Suggestion</span><strong>Rééquilibrer avec le cash disponible</strong></div><span className="tag">Simulation locale</span></div><p className="page-intro">Les montants sont calculés selon les écarts aux cibles. Une préparation ouvre le journal avec un achat prérempli, sans envoyer d’ordre à IG.</p>{recommendations.length ? <div className="recommendations">{recommendations.map((item, index) => <div className="recommendation" key={item.assetClass}><div><strong>{item.assetClass}</strong><small>Priorité {index + 1}</small></div><span>Actuel <b>{formatPercent(item.currentWeight)}</b></span><span>Cible <b>{formatPercent(item.targetWeight)}</b></span><span>Écart <b className="negative">{euro(item.deficit)}</b></span><button className="button secondary" disabled={item.suggestedAmount === 0} onClick={() => onPrepare(item.assetClass, item.suggestedAmount)}>{item.suggestedAmount > 0 ? `Préparer ${euro(item.suggestedAmount)}` : 'Sous le minimum'}</button></div>)}</div> : <div className="empty-journal"><Sparkles size={24} /><strong>Allocation déjà alignée</strong><p>Aucune poche ne présente de déficit par rapport aux cibles actuelles.</p></div>}<div className="rebalance-footer"><span>{actionable.length === 0 ? 'Le cash mobilisable est nul ou inférieur au montant minimal par opération configuré.' : 'Les montants proposés respectent la réserve de liquidités et le montant minimal par opération.'}</span></div></article></section>
}

function HistoryView({ data }: { data: PortfolioData | null }) {
  const points = (data?.history ?? []).map((point) => ({ ...point, date: new Date(point.recordedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }))
  if (points.length === 0) return <section className="card page-card"><div className="empty-journal"><BarChart3 size={24} /><strong>Historique en attente</strong><p>Les prochains ajouts d’opérations ou mises à jour de cours créeront des points de valorisation.</p></div></section>
  const firstValue = points[0].totalValue
  return <section className="page-stack"><article className="card history-chart"><div className="card-heading"><div><span className="card-label">Performance</span><strong>Valeur totale du portefeuille</strong></div><span className="tag">{points.length} point{points.length > 1 ? 's' : ''}</span></div><div className="chart-wrap large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{ top: 22, right: 12, bottom: 0, left: -24 }}><defs><linearGradient id="historyFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#7c9cff" stopOpacity={.35} /><stop offset="100%" stopColor="#7c9cff" stopOpacity={0} /></linearGradient></defs><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: '#737b91', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#737b91', fontSize: 11 }} /><Tooltip contentStyle={{ background: '#1a1e29', border: '1px solid #2b3141', borderRadius: 10 }} formatter={(value) => [euro(Number(value)), 'Valeur']} /><Area type="monotone" dataKey="totalValue" stroke="#8ca8ff" strokeWidth={2.5} fill="url(#historyFill)" /></AreaChart></ResponsiveContainer></div></article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Points de suivi</span><strong>Historique local</strong></div></div>{[...points].reverse().map((point) => <div className="history-row" key={point.id}><span>{new Date(point.recordedAt).toLocaleString('fr-FR')}</span><b>{euro(point.totalValue)}</b><span className={point.totalValue >= firstValue ? 'positive' : 'negative'}>{formatPercent(firstValue === 0 ? 0 : (point.totalValue - firstValue) / firstValue)}</span></div>)}</article></section>
}

function LocalPositionsView({ snapshot }: { snapshot: PortfolioSnapshot | null }) {
  if (!snapshot) return <section className="card page-card"><div className="empty-journal"><BriefcaseBusiness size={24} /><strong>Aucune position</strong><p>Ajoutez un dépôt puis vos achats depuis le journal local.</p></div></section>
  return <section className="card positions-card page-card"><div className="card-heading"><div><span className="card-label">Portefeuille</span><strong>{snapshot.positions.length} position{snapshot.positions.length > 1 ? 's' : ''}</strong></div><span className="tag">Cours locaux</span></div><p className="page-intro">Les valorisations utilisent les cours saisis dans l’écran Cours ; à défaut, le prix de la dernière opération est retenu.</p><div className="table-wrap"><table><thead><tr><th>Instrument</th><th>ISIN</th><th>Catégorie</th><th className="align-right">Valeur</th><th className="align-right">Performance</th><th>Cours</th></tr></thead><tbody>{snapshot.positions.map((position) => <tr key={position.id}><td><div className="transaction-instrument"><strong>{position.name}</strong><small>{position.ticker ?? '—'}</small></div></td><td>{position.isin ?? '—'}</td><td><span className="tag">{position.assetClass}</span></td><td className="align-right value">{euro(position.marketValue)}</td><td className={`align-right ${position.gainLoss >= 0 ? 'positive' : 'negative'}`}>{formatPercent(position.gainLossRate)}</td><td>{position.priceSource}</td></tr>)}</tbody></table></div></section>
}

function LocalQdfView({ data, snapshot, onSavePrice, onEdit, onDisable, onAdd }: { data: PortfolioData | null; snapshot: PortfolioSnapshot | null; onSavePrice: (instrumentId: string, price: number) => void; onEdit: (item: QdfConstituent) => void; onDisable: (ticker: string) => void; onAdd: () => void }) {
  const holdings = data ? calculateQdfHoldings(data) : []
  const constituents = data?.qdfConstituents.filter((item) => item.status === 'Actif').sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999)) ?? []
  return <section className="page-stack"><article className="card page-card"><div className="card-heading"><div><span className="card-label">Poche gérée</span><strong>Qualité Décotée France</strong></div><button className="button primary" onClick={onAdd}><Plus size={16} /> Ajouter un titre</button></div><p className="page-intro">Gérez les titres, leurs pondérations et leurs cours. Les cours ne valorisent une ligne que lorsqu’une opération d’achat existe.</p>{constituents.length ? <div className="table-wrap"><table><thead><tr><th>Instrument</th><th>ISIN</th><th>Cible</th><th>Quantité</th><th className="align-right">Cours</th><th className="align-right">Valeur</th><th /></tr></thead><tbody>{constituents.map((item) => { const holding = holdings.find((position) => position.ticker === item.ticker || normalizeLabel(position.name) === normalizeLabel(item.company)); const savedPrice = holding ? data?.marketPrices?.[holding.id] : undefined; return <tr key={item.ticker}><td><div className="transaction-instrument"><strong>{item.company}</strong><small>{item.ticker}{item.sector ? ` · ${item.sector}` : ''}</small></div></td><td>{item.isin ?? '—'}</td><td>{formatPercent(item.targetWeight)}</td><td>{holding ? formatQuantity(holding.quantity) : '—'}</td><td className="align-right">{holding ? <form className="price-form" onSubmit={(event) => { event.preventDefault(); onSavePrice(holding.id, Number(new FormData(event.currentTarget).get('price'))) }}><input name="price" type="number" min="0.000001" step="any" defaultValue={savedPrice?.value ?? holding.marketPrice} aria-label={`Cours ${item.company}`} required /><button className="button secondary" type="submit">OK</button></form> : '—'}</td><td className="align-right value">{holding ? euro(holding.marketValue) : '—'}</td><td className="align-right"><button className="text-button" onClick={() => onEdit(item)}>Modifier</button><button className="text-button danger-button" onClick={() => onDisable(item.ticker)}>Désactiver</button></td></tr> })}</tbody></table></div> : <div className="empty-journal"><Layers3 size={24} /><strong>Aucun constituant QDF</strong><p>Ajoutez les titres suivis dans la poche QDF.</p></div>}</article>{snapshot && <article className="card metric"><span>Valeur de la poche QDF</span><strong>{euro(snapshot.positions.find((position) => position.id === 'QDF')?.marketValue ?? 0)}</strong></article>}</section>
}

function QdfConstituentDialog({ constituent, onClose, onSubmit }: { constituent: QdfConstituent; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="transaction-dialog card" role="dialog" aria-modal="true" aria-labelledby="qdf-title" onMouseDown={(event) => event.stopPropagation()}><div className="card-heading"><div><span className="card-label">Gestion QDF</span><strong id="qdf-title">{constituent.ticker ? 'Modifier un titre' : 'Ajouter un titre'}</strong></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fermer">×</button></div><form className="transaction-form" onSubmit={onSubmit}><label className="form-wide">Entreprise<input name="company" defaultValue={constituent.company} required /></label><label>Ticker<input name="ticker" defaultValue={constituent.ticker} required /></label><label>ISIN<input name="isin" defaultValue={constituent.isin} /></label><label>Rang<input name="rank" type="number" min="1" step="1" defaultValue={constituent.rank} /></label><label>Secteur<input name="sector" defaultValue={constituent.sector} /></label><label>Poids cible QDF (%)<input name="targetWeight" type="number" min="0" max="100" step="0.01" defaultValue={constituent.targetWeight * 100} required /></label><label className="form-wide">Note<input name="note" defaultValue={constituent.note} /></label><div className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>Annuler</button><button className="button primary" type="submit">Enregistrer</button></div></form></section></div>
}

function LocalControlsView({ issues, hasData }: { issues: ReturnType<typeof validatePortfolio>; hasData: boolean }) {
  const errors = issues.filter((issue) => issue.severity === 'error')
  return <section className="page-stack"><article className="card page-card"><div className="card-heading"><div><span className="card-label">Contrôles locaux</span><strong>{hasData ? (errors.length ? 'Corrections à effectuer' : 'Données cohérentes') : 'Aucune donnée'}</strong></div><span className="tag">{issues.length} alerte{issues.length > 1 ? 's' : ''}</span></div>{!hasData ? <p className="page-intro">Initialisez le portefeuille puis saisissez les opérations à contrôler.</p> : issues.length === 0 ? <div className="validation-success"><ShieldCheck size={20} /><div><strong>Aucune anomalie détectée</strong><p>Les opérations locales respectent les règles actuelles.</p></div></div> : <div className="issue-list">{issues.map((issue) => <div className={`issue ${issue.severity}`} key={issue.id}><div className="issue-icon">{issue.severity === 'error' ? '!' : 'i'}</div><div><strong>{issue.title}</strong><p>{issue.detail}</p></div></div>)}</div>}</article></section>
}

function MarketPricesView({ data, snapshot, onSave }: { data: PortfolioData | null; snapshot: PortfolioSnapshot | null; onSave: (instrumentId: string, price: number) => void }) {
  if (!data || !snapshot) return <section className="card page-card"><div className="empty-journal"><RefreshCw size={24} /><strong>Aucun cours à renseigner</strong><p>Ajoutez d’abord un dépôt puis une opération d’achat pour faire apparaître une position.</p></div></section>
  const positions = snapshot.positions.filter((position) => position.id !== 'QDF')
  return <section className="page-stack"><article className="card page-card"><div className="card-heading"><div><span className="card-label">Valorisation locale</span><strong>Saisir les cours</strong></div><span className="tag">Aucune connexion externe</span></div><p className="page-intro">Saisissez le dernier cours connu de chaque position. La valorisation et la performance sont recalculées immédiatement dans ce navigateur.</p><div className="table-wrap"><table><thead><tr><th>Instrument</th><th>ISIN</th><th>Quantité</th><th className="align-right">Cours utilisé</th><th>Dernière mise à jour</th><th className="align-right">Nouveau cours (€)</th><th /></tr></thead><tbody>{positions.map((position) => { const price = data.marketPrices?.[position.id]; return <tr key={position.id}><td><div className="transaction-instrument"><strong>{position.name}</strong><small>{position.ticker ?? '—'}</small></div></td><td>{position.isin ?? '—'}</td><td>{formatQuantity(position.quantity)}</td><td className="align-right value">{euro(position.marketPrice)}</td><td>{price ? new Date(price.updatedAt).toLocaleString('fr-FR') : 'Prix de la dernière opération'}</td><td className="align-right"><form className="price-form" onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get('price'); onSave(position.id, Number(value)); }}><input name="price" type="number" min="0.000001" step="any" defaultValue={price?.value ?? position.marketPrice} aria-label={`Cours ${position.name}`} required /><button className="button secondary" type="submit">Enregistrer</button></form></td></tr> })}</tbody></table></div></article></section>
}

function LocalDataView({ data, onInitialize, onRestore, message, importMessage, onImportIgPaste, onImportIgPricesPaste, onImportIgCashPaste }: { data: PortfolioData | null; onInitialize: () => void; onRestore: (event: ChangeEvent<HTMLInputElement>) => void; message: string | null; importMessage: string | null; onImportIgPaste: (event: FormEvent<HTMLFormElement>) => void; onImportIgPricesPaste: (event: FormEvent<HTMLFormElement>) => void; onImportIgCashPaste: (event: FormEvent<HTMLFormElement>) => void }) {
  return <section className="page-stack"><article className="card import-hero"><div className="insight-icon purple"><Database size={21} /></div><div><span className="card-label">Portefeuille local</span><strong>Vos données restent dans ce navigateur</strong><p>Ajoutez directement les opérations dans le journal et actualisez les cours dans l’écran dédié.</p></div><span className="tag">Sans import API IG</span></article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Démarrage</span><strong>{data ? 'Portefeuille initialisé' : 'Initialiser le portefeuille'}</strong></div>{!data && <button className="button primary" onClick={onInitialize}>Créer un portefeuille vide</button>}</div>{data ? <div className="import-summary"><span><b>{data.transactions.length}</b> opérations locales</span><span><b>{Object.keys(data.marketPrices ?? {}).length}</b> cours saisis</span><span><b>{data.auditLog?.length ?? 0}</b> événements audités</span></div> : <p className="page-intro">Commencez par créer un portefeuille vide, puis enregistrez un dépôt et vos achats dans le journal.</p>}</article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Import transactions</span><strong>Coller les ordres exécutés IG</strong></div><span className="tag">Copier / coller</span></div><p className="page-intro">Depuis IG, copiez les lignes du tableau <b>Ordres &gt; Exécutés</b> puis collez-les ici. Les montants et quantités seront importés automatiquement.</p><form className="page-stack" onSubmit={onImportIgPaste}><label>Classe d’actif par défaut<select name="fallbackAssetClass" defaultValue="ETF Maison"><option>Actions individuelles</option><option>ETF Monde</option><option>ETF Small Caps</option><option>ETF Maison</option><option>Non classé</option></select></label><label className="form-wide">Collage brut IG<textarea name="igPaste" rows={8} placeholder="Collez ici les lignes copiées depuis IG (avec colonnes Entreprise, Quantité, Type et prix, Exécuté)." required /></label><div className="inline-actions"><button className="button primary" type="submit">Importer dans le journal</button></div></form>{importMessage && <p className="import-warning">{importMessage}</p>}</article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Import trésorerie</span><strong>Coller l’historique cash IG</strong></div><span className="tag">Dépôts</span></div><p className="page-intro">Collez l’historique des transactions cash (Dépôt / Retrait). Seuls les dépôts sont importés pour corriger le cash sans dupliquer les achats.</p><form className="page-stack" onSubmit={onImportIgCashPaste}><label className="form-wide">Historique trésorerie<textarea name="igCashPaste" rows={8} placeholder="Collez ici l'historique avec montants et dates (ex: Dépôt 200,00 € 30/10/2026...)." required /></label><div className="inline-actions"><button className="button primary" type="submit">Importer les dépôts</button></div></form></article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Import cours</span><strong>Coller la table Vos avoirs</strong></div><span className="tag">Prix actuel</span></div><p className="page-intro">Copiez les lignes de <b>Vos avoirs</b> puis collez-les. Les cours seront appariés sur ticker ou nom d’instrument et mis à jour automatiquement.</p><form className="page-stack" onSubmit={onImportIgPricesPaste}><label className="form-wide">Collage brut IG<textarea name="igPricesPaste" rows={8} placeholder="Collez ici les lignes copiées depuis IG (Entreprise, Titres, Prix actuel...)." required /></label><div className="inline-actions"><button className="button primary" type="submit">Importer les cours</button></div></form></article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Sauvegarde</span><strong>Exporter ou restaurer les données</strong></div><span className="tag">JSON local</span></div><p className="page-intro">Conservez une copie JSON avant de vider les données du navigateur ou de changer d’appareil.</p><div className="inline-actions">{data && <button className="button secondary" onClick={() => downloadPortfolioBackup(data)}>Télécharger la sauvegarde</button>}<label className="button secondary" htmlFor="restore-backup">Restaurer une sauvegarde</label><input id="restore-backup" className="file-input" type="file" accept="application/json,.json" onChange={onRestore} /></div>{message && <p className="import-warning">{message}</p>}</article></section>
}

function PdfStatementsDataView({ data, importMessage, backupMessage, isImporting, storageDirectory, isDesktop, onImportPdf, onReset, onChooseStorageDirectory, onDownloadBackup, onRestoreBackup, updateState, isUpdateActionLoading, onCheckForUpdate, onDownloadUpdate, onInstallUpdate }: { data: PortfolioData | null; importMessage: string | null; backupMessage: string | null; isImporting: boolean; storageDirectory: string | null; isDesktop: boolean; onImportPdf: (event: FormEvent<HTMLFormElement>) => Promise<void>; onReset: () => void; onChooseStorageDirectory: () => Promise<void>; onDownloadBackup: () => void; onRestoreBackup: (event: ChangeEvent<HTMLInputElement>) => Promise<void>; updateState: DesktopUpdateState | null; isUpdateActionLoading: boolean; onCheckForUpdate: () => Promise<void>; onDownloadUpdate: () => Promise<void>; onInstallUpdate: () => Promise<void> }) {
  return <section className="page-stack"><article className="card import-hero"><div className="insight-icon purple"><Database size={21} /></div><div><span className="card-label">Portefeuille local</span><strong>Import unique depuis relevés PDF IG</strong><p>Le portefeuille est reconstruit à partir des relevés PDF téléchargés depuis l’historique IG.</p></div><span className="tag">Flux unique</span></article><article className="card page-card"><div className="card-heading"><div><span className="card-label">État local</span><strong>{data ? 'Données présentes' : 'Aucune donnée locale'}</strong></div><button className="button secondary danger-button" type="button" onClick={onReset}>Vider l’application</button></div>{data ? <div className="import-summary"><span><b>{data.transactions.length}</b> opérations locales</span><span><b>{Object.keys(data.marketPrices ?? {}).length}</b> cours saisis</span><span><b>{data.auditLog?.length ?? 0}</b> événements audités</span></div> : <p className="page-intro">Importez vos relevés PDF pour reconstruire l’historique complet.</p>}{storageDirectory && <p className="page-intro">Dossier des données: <b>{storageDirectory}</b></p>}{isDesktop && <div className="inline-actions"><button className="button secondary" type="button" onClick={() => { void onChooseStorageDirectory() }}>Changer le dossier de données</button></div>}</article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Sauvegarde</span><strong>Exporter ou restaurer les données</strong></div><span className="tag">JSON local</span></div><p className="page-intro">Conservez une copie JSON avant de vider l’application ou avant une migration de poste.</p><div className="inline-actions"><button className="button secondary" type="button" onClick={onDownloadBackup}>Créer une sauvegarde</button><label className="button secondary" htmlFor="restore-backup">Restaurer une sauvegarde</label><input id="restore-backup" className="file-input" type="file" accept="application/json,.json" onChange={(event) => { void onRestoreBackup(event) }} /></div>{backupMessage && <p className="import-warning">{backupMessage}</p>}</article>{isDesktop && <article className="card page-card"><div className="card-heading"><div><span className="card-label">Application desktop</span><strong>Mises a jour automatiques</strong></div><span className="tag">Version {updateState?.currentVersion ?? 'inconnue'}</span></div><p className="page-intro">Recherche et installation de nouvelles versions depuis GitHub Releases.</p><div className="inline-actions"><button className="button secondary" type="button" disabled={isUpdateActionLoading || updateState?.status === 'checking'} onClick={() => { void onCheckForUpdate() }}>{updateState?.status === 'checking' ? 'Verification...' : 'Verifier les mises a jour'}</button><button className="button secondary" type="button" disabled={isUpdateActionLoading || updateState?.status !== 'available'} onClick={() => { void onDownloadUpdate() }}>{updateState?.status === 'downloading' ? 'Telechargement...' : 'Telecharger la mise a jour'}</button><button className="button primary" type="button" disabled={isUpdateActionLoading || updateState?.status !== 'downloaded'} onClick={() => { void onInstallUpdate() }}>Installer et redemarrer</button></div>{updateState?.message && <p className="import-warning">{updateState.message}</p>}</article>}<article className="card page-card"><div className="card-heading"><div><span className="card-label">Import relevés IG</span><strong>Analyser des PDF de transactions</strong></div><span className="tag">Multi-fichiers</span></div><p className="page-intro">Sélectionnez les relevés PDF téléchargés dans IG. L’application extrait automatiquement les transactions détectées et évite les doublons.</p><form className="page-stack" onSubmit={onImportPdf}><label>Classe d’actif de secours<select name="fallbackAssetClass" defaultValue="Non classé"><option>Non classé</option><option>Actions individuelles</option><option>ETF Monde</option><option>ETF Small Caps</option><option>ETF Maison</option></select></label><p className="page-intro">Utilisée uniquement si l’instrument n’est pas reconnu automatiquement.</p><label className="form-wide">Relevés PDF<input name="statementPdfs" type="file" accept=".pdf,application/pdf" multiple required /></label><div className="inline-actions"><button className="button primary" type="submit" disabled={isImporting}>{isImporting ? 'Analyse en cours…' : 'Importer les relevés PDF'}</button></div></form>{importMessage && <p className="import-warning">{importMessage}</p>}</article></section>
}

/* Anciennes vues d’import Excel et de rapprochement, retirées du produit local.
function LegacyImportView({ portfolioData, report, error, isImporting, inputRef, onImport, pendingImport, comparison, onMerge, onDiscardPending }: Record<string, any> & { report: { warnings: string[] } | null }) {
  return <section className="page-stack"><article className="card import-hero"><div className="insight-icon purple"><Database size={21} /></div><div><span className="card-label">Données locales</span><strong>Import Excel et suivi auditable</strong><p>Le portefeuille est alimenté par le classeur Excel, les opérations locales et les versions sauvegardées dans ce navigateur.</p></div><span className="tag">Sans API externe</span></article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Import initial</span><strong>Importer l'historique Excel</strong></div><input ref={inputRef} className="file-input" type="file" accept=".xlsx,.xls" onChange={onImport} /><button className="button primary" onClick={() => inputRef.current?.click()} disabled={isImporting}>{isImporting ? 'Analyse en cours…' : portfolioData ? 'Comparer un classeur' : 'Choisir un fichier'}</button></div><p className="page-intro">Le classeur reste inchangé. L’import lit uniquement les feuilles <b>Transactions</b>, <b>Paramètres</b> et <b>QDF - Gestion</b>, puis sauvegarde le modèle de données dans ce navigateur.</p>{error && <div className="import-status error"><span>{error}</span></div>}{portfolioData ? <div className="import-result"><div className="import-status"><Database size={18} /><span><b>{portfolioData.sourceFileName}</b><small>Importé le {new Date(portfolioData.importedAt).toLocaleString('fr-FR')}</small></span><b>Import réussi</b></div><div className="import-summary"><span><b>{portfolioData.transactions.length}</b> opérations</span><span><b>{portfolioData.allocationTargets.length}</b> cibles d’allocation</span><span><b>{portfolioData.qdfConstituents.length}</b> composants QDF</span></div>{report?.warnings.map((warning) => <p className="import-warning" key={warning}>{warning}</p>)}</div> : <div className="import-status"><Database size={18} /><span>Format attendu : le classeur de suivi actuellement présent dans le dépôt.</span><b>Prêt à analyser</b></div>}</article>{pendingImport && comparison && <article className="card page-card comparison-card"><div className="card-heading"><div><span className="card-label">Réimport analysé</span><strong>{pendingImport.data.sourceFileName}</strong></div><span className="tag">Fusion à confirmer</span></div><p className="page-intro">Aucune donnée n’a encore été modifiée. Les opérations locales et les opérations Excel absentes du nouveau classeur seront conservées.</p><div className="import-summary comparison-summary"><span><b>{comparison.newTransactions.length}</b> nouvelle{comparison.newTransactions.length > 1 ? 's' : ''}</span><span><b>{comparison.unchangedCount}</b> déjà connue{comparison.unchangedCount > 1 ? 's' : ''}</span><span><b>{comparison.missingTransactions.length}</b> absente{comparison.missingTransactions.length > 1 ? 's' : ''} mais conservée{comparison.missingTransactions.length > 1 ? 's' : ''}</span></div>{comparison.missingTransactions.length > 0 && <p className="import-warning">Les opérations absentes ne sont pas annulées automatiquement : vérifiez-les depuis le journal.</p>}<div className="dialog-actions"><button className="button secondary" onClick={onDiscardPending}>Ignorer ce réimport</button><button className="button primary" onClick={onMerge}>Intégrer les nouvelles opérations</button></div></article>}</section>
}

function LegacyImportHistoryView({ data, onRestore }: any) {
  const revisions = [...(data?.importHistory ?? [])].reverse()
  const snapshot = data ? calculatePortfolio(data) : null
  const reference = data?.excelReference
  return <section className="page-stack"><article className="card page-card"><div className="card-heading"><div><span className="card-label">Rapprochement</span><strong>Référence du dernier import Excel</strong></div><span className="tag">Calcul reproductible</span></div>{reference && snapshot ? <div className="reconciliation-grid"><div><span>Valeur importée</span><strong>{euro(reference.totalValue)}</strong><small>Écart actuel {signedEuro(snapshot.totalValue - reference.totalValue)}</small></div><div><span>Cash importé</span><strong>{euro(reference.cash)}</strong><small>Écart actuel {signedEuro(snapshot.cash - reference.cash)}</small></div><div><span>Valorisation</span><strong>{new Date(reference.capturedAt).toLocaleString('fr-FR')}</strong><small>Référence : {reference.sourceFileName}</small></div></div> : <div className="empty-journal"><Database size={24} /><strong>Référence disponible au prochain import</strong><p>Réimportez le classeur pour conserver une référence de rapprochement et son horodatage.</p></div>}</article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Versions locales</span><strong>Historique des imports</strong></div><span className="tag">{revisions.length} version{revisions.length > 1 ? 's' : ''}</span></div>{revisions.length ? <div className="revision-list">{revisions.map((revision) => <div className="revision-row" key={revision.id}><div><strong>{revision.sourceFileName}</strong><small>{new Date(revision.importedAt).toLocaleString('fr-FR')} · {revision.transactionCount} opérations</small></div><button className="button secondary" onClick={() => onRestore(revision.id)}>Restaurer</button></div>)}</div> : <p className="page-intro">Les prochains imports créeront une version restaurable dans ce navigateur.</p>}</article></section>
}

*/
function SettingsView({ data, onSave, message }: { data: PortfolioData | null; onSave: (event: FormEvent<HTMLFormElement>) => void; message: string | null }) {
  const defaults = data ?? createLocalPortfolio()
  const target = (assetClass: AssetClass) => (defaults.allocationTargets.find((item) => item.assetClass === assetClass)?.targetWeight ?? 0) * 100
  const targets: Array<{ assetClass: AssetClass; label: string; color: string }> = [{ assetClass: 'ETF Monde', label: 'ETF Monde', color: '#7c9cff' }, { assetClass: 'ETF Small Caps', label: 'ETF Small Caps', color: '#69d4b4' }, { assetClass: 'Actions individuelles', label: 'Actions', color: '#e8af63' }, { assetClass: 'ETF Maison', label: 'QDF', color: '#b48cff' }]
  return <form className="page-stack" onSubmit={onSave}><article className="card page-card"><div className="card-heading"><div><span className="card-label">Stratégie</span><strong>Allocation cible</strong></div><button className="button primary" type="submit">Enregistrer</button></div><div className="settings-list">{targets.map((item) => <label key={item.assetClass}><span className="legend-name"><i style={{ background: item.color }} />{item.label}</span><div><input name={item.assetClass} type="number" min="0" max="100" step="0.01" defaultValue={target(item.assetClass)} aria-label={`Cible ${item.label}`} required /><span>%</span></div></label>)}</div></article><article className="card page-card"><div className="card-heading"><div><span className="card-label">Rééquilibrage</span><strong>Règles de gestion</strong></div></div><div className="settings-list rules"><label><span>Réserve de liquidités minimale</span><div><input name="minimumCashWeight" type="number" min="0" max="100" step="0.01" defaultValue={defaults.rebalancingRules.minimumCashWeight * 100} aria-label="Réserve minimale" required /><span>%</span></div></label><label><span>Montant minimal par opération</span><div><input name="minimumOrderAmount" type="number" min="0" step="0.01" defaultValue={defaults.rebalancingRules.minimumOrderAmount} aria-label="Montant minimal" required /><span>€</span></div></label><label><span>Nombre cible de lignes actions</span><div><input name="targetIndividualStockCount" type="number" min="0" step="1" defaultValue={defaults.rebalancingRules.targetIndividualStockCount} aria-label="Nombre cible de lignes actions" required /></div></label></div>{message && <p className="import-warning">{message}</p>}</article></form>
}

const allocationVisuals: Record<string, { name: string; color: string }> = {
  'ETF Monde': { name: 'ETF Monde', color: '#7c9cff' },
  'ETF Small Caps': { name: 'ETF Small Caps', color: '#69d4b4' },
  'Actions individuelles': { name: 'Actions', color: '#e8af63' },
  'ETF Maison': { name: 'QDF', color: '#b48cff' },
  'Non classé': { name: 'Non classé', color: '#8f9bb3' },
  Liquidités: { name: 'Liquidités', color: '#667085' },
}

function toAllocationDisplay(snapshot: PortfolioSnapshot) {
  return snapshot.allocation.map((line) => ({
    name: allocationVisuals[line.assetClass].name,
    value: line.weight * 100,
    target: line.targetWeight * 100,
    color: allocationVisuals[line.assetClass].color,
  }))
}

function toPositionDisplay(snapshot: PortfolioSnapshot) {
  return [...snapshot.positions]
    .sort((left, right) => right.marketValue - left.marketValue)
    .map((position) => ({
      id: position.id,
      name: position.name,
      ticker: position.ticker ?? '—',
      isin: position.isin,
      type: position.assetClass === 'ETF Maison' ? 'Poche gérée' : position.assetClass,
      value: euro(position.marketValue),
      weight: formatPercent(snapshot.totalValue === 0 ? 0 : position.marketValue / snapshot.totalValue),
      change: formatPercent(position.gainLossRate),
      positive: position.gainLoss >= 0,
    }))
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '' : '−'}${Math.abs(value * 100).toFixed(2).replace('.', ',')} %`
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 10 }).format(value)
}

function signedEuro(value: number): string {
  return `${value >= 0 ? '+' : '−'}${euro(Math.abs(value))}`
}

const STORAGE_KEY = 'ig-portefeuille-data'
const STORAGE_FORMAT = 'ig-portefeuille-data'
const CURRENT_DATA_SCHEMA_VERSION = 2

interface PersistedPortfolioEnvelope {
  format: typeof STORAGE_FORMAT
  schemaVersion: typeof CURRENT_DATA_SCHEMA_VERSION
  savedAt: string
  data: PortfolioData
}

export interface PortfolioBackupAdapter {
  pushSnapshot: (payload: PersistedPortfolioEnvelope) => Promise<void>
}

let configuredBackupAdapter: PortfolioBackupAdapter | null = null

export function configurePortfolioBackupAdapter(adapter: PortfolioBackupAdapter | null): void {
  configuredBackupAdapter = adapter
}

function isDesktopRuntime(): boolean {
  return Boolean(window.desktopAPI?.isDesktop)
}

function getPortfolioStorageDirectory(): string | null {
  if (!isDesktopRuntime()) return null
  try {
    return window.desktopAPI?.getDataDirectorySync() ?? null
  } catch {
    return null
  }
}

function readStoragePayload(): string | null {
  if (isDesktopRuntime()) {
    return window.desktopAPI?.readPortfolioDataSync() ?? null
  }
  return window.localStorage.getItem(STORAGE_KEY)
}

function writeStoragePayload(content: string): void {
  if (isDesktopRuntime()) {
    window.desktopAPI?.writePortfolioDataSync(content)
    return
  }
  window.localStorage.setItem(STORAGE_KEY, content)
}

function isPersistedPortfolioEnvelope(value: unknown): value is PersistedPortfolioEnvelope {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedPortfolioEnvelope>
  return candidate.format === STORAGE_FORMAT && candidate.schemaVersion === CURRENT_DATA_SCHEMA_VERSION && Boolean(candidate.data)
}

function migratePortfolioSchema(data: PortfolioData): PortfolioData {
  if (data.schemaVersion === CURRENT_DATA_SCHEMA_VERSION) return data
  if (data.schemaVersion === 1) {
    return { ...data, schemaVersion: CURRENT_DATA_SCHEMA_VERSION }
  }
  return { ...data, schemaVersion: CURRENT_DATA_SCHEMA_VERSION }
}

function extractPortfolioDataFromStoredValue(parsed: unknown): PortfolioData | null {
  if (isPersistedPortfolioEnvelope(parsed)) {
    return migratePortfolioSchema(parsed.data)
  }
  if (isPortfolioData(parsed)) {
    return migratePortfolioSchema(parsed)
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as { data?: unknown }
  if (candidate.data && isPortfolioData(candidate.data)) {
    return migratePortfolioSchema(candidate.data)
  }
  return null
}

function buildPersistedEnvelope(data: PortfolioData): PersistedPortfolioEnvelope {
  return {
    format: STORAGE_FORMAT,
    schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    data,
  }
}

function loadPortfolioData(): PortfolioData | null {
  try {
    const rawData = readStoragePayload()
    if (!rawData) return null
    const parsed = JSON.parse(rawData) as unknown
    const extracted = extractPortfolioDataFromStoredValue(parsed)
    if (!extracted) return null
    const parsedPortfolio = extracted as PortfolioData & { importedAt?: string }
    const normalized = normalizePortfolioData({ ...parsedPortfolio, createdAt: parsedPortfolio.createdAt ?? parsedPortfolio.importedAt ?? new Date().toISOString(), marketPrices: parsedPortfolio.marketPrices ?? {} })
    if (JSON.stringify(parsedPortfolio) !== JSON.stringify(normalized)) {
      savePortfolioData(normalized)
    }
    return normalized
  } catch {
    return null
  }
}

function normalizePortfolioData(data: PortfolioData): PortfolioData {
  const migratedTransactions = data.transactions.map((transaction) => {
    const note = transaction.note ?? ''
    const imported = note.includes('Import IG par collage') || note.includes('Import relevé PDF IG')
    const looksLikeEtf = /etf|small cap|ucits|vanguard|ishares|amundi|msci|ftse/i.test(transaction.instrumentName)
    const isCoreIndividualStock = isCoreIndividualSecurity(transaction)
    const knownAssetClass = detectKnownAssetClass({ isin: transaction.isin, ticker: transaction.ticker })

    if (knownAssetClass && transaction.assetClass !== knownAssetClass && transaction.assetClass !== 'ETF Maison') {
      return {
        ...transaction,
        assetClass: knownAssetClass,
      }
    }

    if (isCoreIndividualStock && transaction.assetClass !== 'Actions individuelles') {
      return {
        ...transaction,
        assetClass: 'Actions individuelles' as AssetClass,
      }
    }

    const canPromoteToQdf = transaction.assetClass === 'Actions individuelles' || transaction.assetClass === 'Non classé'
    if (imported && canPromoteToQdf && !looksLikeEtf && !isCoreIndividualStock) {
      return { ...transaction, assetClass: 'ETF Maison' as AssetClass, ticker: transaction.ticker ?? deriveTickerFromName(transaction.instrumentName) }
    }
    return transaction
  })

  let nextData: PortfolioData = { ...data, transactions: migratedTransactions }

  if ((nextData.qdfConstituents?.length ?? 0) > 0) {
    const remainingConstituents = nextData.qdfConstituents.filter((constituent) => !isCoreIndividualSecurity({ instrumentName: constituent.company, ticker: constituent.ticker, isin: constituent.isin }))
    if (remainingConstituents.length !== nextData.qdfConstituents.length) {
      const totalWeight = remainingConstituents.reduce((sum, constituent) => sum + (constituent.targetWeight > 0 ? constituent.targetWeight : 0), 0)
      const normalizedConstituents = remainingConstituents.map((constituent, index) => ({
        ...constituent,
        rank: index + 1,
        targetWeight: remainingConstituents.length === 0 ? 0 : totalWeight > 0 ? constituent.targetWeight / totalWeight : 1 / remainingConstituents.length,
      }))
      nextData = { ...nextData, qdfConstituents: normalizedConstituents }
    }
  }

  if ((nextData.qdfConstituents?.length ?? 0) === 0) {
    const qdfBuys = nextData.transactions.filter((transaction) => transaction.kind === 'Achat' && transaction.assetClass === 'ETF Maison' && !transaction.cancelledAt)
    if (qdfBuys.length > 0) {
      const unique = new Map<string, { company: string; ticker: string }>()
      for (const buy of qdfBuys) {
        const ticker = buy.ticker ?? deriveTickerFromName(buy.instrumentName)
        const key = `${ticker}|${buy.instrumentName}`
        if (!unique.has(key)) unique.set(key, { company: buy.instrumentName, ticker })
      }
      const targetWeight = unique.size > 0 ? 1 / unique.size : 0
      nextData = {
        ...nextData,
        qdfConstituents: [...unique.values()].map((item, index) => ({
          status: 'Actif',
          rank: index + 1,
          company: item.company,
          ticker: item.ticker,
          targetWeight,
        })),
      }
    }
  }

  const hasAutoFunding = nextData.transactions.some((transaction) => transaction.instrumentName === 'Alimentation cash (auto import IG)')
  const hasExplicitCashOps = nextData.transactions.some((transaction) => transaction.kind === 'Dépôt' || transaction.kind === 'Dividende' || transaction.kind === 'Frais')
  const netCash = nextData.transactions.reduce((sum, transaction) => sum + (transaction.cashFlow ?? 0), 0)
  if (hasAutoFunding || hasExplicitCashOps || netCash >= 0 || nextData.transactions.length === 0) return nextData
  const firstDate = [...nextData.transactions].map((transaction) => transaction.occurredOn).sort()[0] ?? new Date().toISOString().slice(0, 10)
  return {
    ...nextData,
    transactions: [...nextData.transactions, {
      id: `manual-${crypto.randomUUID()}`,
      occurredOn: firstDate,
      kind: 'Dépôt',
      instrumentName: 'Alimentation cash (auto import IG)',
      grossAmount: Math.abs(netCash),
      fees: 0,
      cashFlow: Math.abs(netCash),
      assetClass: 'Liquidités',
      note: 'Ajustement automatique pour refléter un portefeuille valorisable sans historique des dépôts IG.',
    }],
  }
}

function deriveTickerFromName(name: string): string {
  const compact = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim()
  const words = compact.split(/\s+/).filter(Boolean)
  const first = words.slice(0, 3).map((word) => word[0]).join('').toUpperCase()
  const fallback = compact.replace(/\s+/g, '').slice(0, 5).toUpperCase()
  return first || fallback || 'QDF'
}

function createLocalPortfolio(): PortfolioData {
  return {
    schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    transactions: [],
    marketPrices: {},
    allocationTargets: [
      { assetClass: 'ETF Monde', targetWeight: 0.65 },
      { assetClass: 'ETF Small Caps', targetWeight: 0.1 },
      { assetClass: 'Actions individuelles', targetWeight: 0.1 },
      { assetClass: 'ETF Maison', targetWeight: 0.1 },
    ],
    rebalancingRules: { minimumCashWeight: 0.05, minimumOrderAmount: 10, targetIndividualStockCount: 3 },
    qdfConstituents: [],
  }
}

function savePortfolioData(data: PortfolioData): void {
  const migratedData = migratePortfolioSchema(data)
  const envelope = buildPersistedEnvelope(migratedData)
  writeStoragePayload(JSON.stringify(envelope))

  if (configuredBackupAdapter) {
    void configuredBackupAdapter.pushSnapshot(envelope).catch((error) => {
      console.error('Echec de sauvegarde backend (adapter):', error)
    })
  }
}

function downloadPortfolioBackup(data: PortfolioData): void {
  const content = JSON.stringify({ format: 'ig-portefeuille-backup', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `sauvegarde-portefeuille-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function isPortfolioData(value: unknown): value is PortfolioData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<PortfolioData>
  const hasKnownSchema = data.schemaVersion === 1 || data.schemaVersion === CURRENT_DATA_SCHEMA_VERSION
  return hasKnownSchema && Array.isArray(data.transactions) && Array.isArray(data.allocationTargets) && Array.isArray(data.qdfConstituents) && Boolean(data.rebalancingRules)
}

function positiveNumber(value: FormDataEntryValue | null): number | undefined {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : undefined
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function optionalFormText(value: FormDataEntryValue | null): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

function calculateManualCashFlow(kind: TransactionKind, grossAmount: number, fees: number): number {
  if (kind === 'Dépôt' || kind === 'Dividende') return grossAmount - fees
  if (kind === 'Achat') return -(grossAmount + fees)
  if (kind === 'Vente') return grossAmount - fees
  if (kind === 'Frais') return -Math.max(grossAmount, fees)
  return 0
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

function parseFrenchNumber(raw: string): number | undefined {
  const compact = raw.replace(/\u00A0/g, ' ').replace(/\s+/g, '').replace(/[^\d,.-]/g, '')
  if (!compact) return undefined
  const trimmed = compact.replace(/[.,]+$/g, '')
  if (!trimmed) return undefined
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed
  const value = Number(normalized)
  return Number.isFinite(value) ? value : undefined
}

function parseIsin(value: string): string | undefined {
  const match = value.match(/\b[A-Z]{2}[A-Z0-9]{10}\b/)
  return match?.[0]
}

function inferAssetClassFromName(name: string, fallback: AssetClass, isin?: string, ticker?: string): AssetClass {
  const knownAssetClass = detectKnownAssetClass({ isin, ticker })
  if (knownAssetClass) return knownAssetClass

  const normalized = name.toLowerCase()
  if (isCoreIndividualSecurity({ instrumentName: name })) return 'Actions individuelles'
  if (normalized.includes('small cap') || /\bsm\.?\s*c(a|ap)\b/i.test(name)) return 'ETF Small Caps'
  if (normalized.includes('etf') || normalized.includes('ucits') || normalized.includes('amundi') || normalized.includes('vanguard') || normalized.includes('ishares') || normalized.includes('vang.') || normalized.includes('ishs')) return 'ETF Monde'
  if (/\b(sa|inc|corp|group|holding|plc|ltd|nv|technology|technologies)\b/i.test(name)) return 'Actions individuelles'
  return fallback
}

function detectKnownAssetClass(input: { isin?: string; ticker?: string }): AssetClass | undefined {
  const isin = (input.isin ?? '').toUpperCase()
  const ticker = (input.ticker ?? '').toUpperCase()

  if (isin === 'IE00BF4RFH31' || ticker === 'WSML') return 'ETF Small Caps'
  if (isin === 'IE00BK5BQT80' || ticker === 'VWRA') return 'ETF Monde'
  return undefined
}

function isCoreIndividualSecurity(input: { instrumentName?: string; ticker?: string; isin?: string }): boolean {
  const name = input.instrumentName ?? ''
  const ticker = (input.ticker ?? '').toUpperCase()
  const isin = (input.isin ?? '').toUpperCase()

  if (isin === 'FR0000120073' || isin === 'US87357P1003') return true
  if (ticker === 'TCMD' || ticker === 'TST' || ticker === 'AI' || ticker === 'ALI') return true
  if (/air\s*liquide/i.test(name)) return true
  if (/tactile\s*(systems?|sys)\s*(technology|tech)|tactile\s*sys\s*tech/i.test(name)) return true
  return false
}

function toIsoDate(dayMonthYear: string): string | undefined {
  const match = dayMonthYear.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return undefined
  return `${match[3]}-${match[2]}-${match[1]}`
}

function parseIgExecutedOrdersPaste(raw: string): Array<{ instrumentName: string; isin?: string; quantity: number; grossAmount: number; unitPrice?: number; occurredOn: string; kind: TransactionKind }> {
  const normalized = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/(\d{2}\/\d{2}\/\d{4})(\d{2}:\d{2})/g, '$1 $2')
    .replace(/(\d{2}\/\d{2}\/\d{4})\s*\n\s*(\d{2}:\d{2})/g, '$1 $2')
  const parsed: Array<{ instrumentName: string; isin?: string; quantity: number; grossAmount: number; unitPrice?: number; occurredOn: string; kind: TransactionKind }> = []
  const regex = /([^\n]+?)\s*\n\s*([\d.,]+)\s*€\s*\n\s*(Acheter|Vendre)\s*([\d.,]+)\s*\n\s*Ordre[^\n]*?à\s*([\d.,]+)\s*€\s*\n\s*(\d{2}\/\d{2}\/\d{4})(?:\s*\d{2}:\d{2})?/gi

  for (const match of normalized.matchAll(regex)) {
    const instrumentName = match[1]
      .replace(/\s+/g, ' ')
      .replace(/^[A-Z0-9.\-]{2,10}(?=[A-ZÀ-ÖØ-Þ])/u, '')
      .trim()
    const unitPrice = parseFrenchNumber(match[2])
    const kind: TransactionKind = /vendre/i.test(match[3]) ? 'Vente' : 'Achat'
    const quantity = parseFrenchNumber(match[4])
    const grossAmount = parseFrenchNumber(match[5])
    const occurredOn = toIsoDate(match[6])

    if (!instrumentName || !quantity || !grossAmount || !occurredOn) continue
    parsed.push({ instrumentName, quantity, grossAmount, unitPrice, occurredOn, kind })
  }

  if (parsed.length > 0) return parsed

  const rows = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  for (const row of rows) {
    const lowered = row.toLowerCase()
    if (lowered.includes('entreprise') || lowered.includes('prix actuel')) continue
    if (!/(acheter|vendre)/i.test(row) || !/\d{2}\/\d{2}\/\d{4}/.test(row)) continue

    const quantityMatch = row.match(/(acheter|vendre)\s*([\d.,]+)/i)
    const quantity = quantityMatch ? parseFrenchNumber(quantityMatch[2]) : undefined
    const kind: TransactionKind = quantityMatch && /vendre/i.test(quantityMatch[1]) ? 'Vente' : 'Achat'

    const dateMatch = row.match(/(\d{2}\/\d{2}\/\d{4})/)
    const occurredOn = dateMatch ? toIsoDate(dateMatch[1]) : undefined

    const euroMatches = [...row.matchAll(/([\d.,]+)\s*€/g)]
    const lastEuro = euroMatches.at(-1)?.[1]
    const grossAmount = lastEuro ? parseFrenchNumber(lastEuro) : undefined
    const unitPrice = euroMatches.length >= 2 ? parseFrenchNumber(euroMatches[0][1]) : undefined

    const instrumentPrefix = row.split(/(acheter|vendre)/i)[0]?.trim() ?? ''
    let instrumentName = instrumentPrefix
      .replace(/\t/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[A-Z0-9.\-]{1,10}\s+/, '')
      .replace(/([\d.,]+)\s*€\s*$/, '')
      .trim()

    if (!instrumentName && row.includes('\t')) {
      const cells = row.split('\t').map((item) => item.trim()).filter(Boolean)
      instrumentName = cells.find((cell) => /[A-Za-z]/.test(cell) && !/€/.test(cell) && !/(acheter|vendre)/i.test(cell) && !/\d{2}\/\d{2}\/\d{4}/.test(cell)) ?? ''
    }

    if (!instrumentName || !quantity || !grossAmount || !occurredOn) continue
    parsed.push({ instrumentName, quantity, grossAmount, unitPrice, occurredOn, kind })
  }

  return parsed
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseIgHoldingsPaste(raw: string): Array<{ ticker?: string; instrumentName: string; quantity: number; marketPrice: number }> {
  const normalized = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\u00A0/g, ' ')
  const rows = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const parsed: Array<{ ticker?: string; instrumentName: string; quantity: number; marketPrice: number }> = []

  const blockRegex = /([^\n]+?)\s*\n\s*[\d.,]+\s*€\s*\n\s*[+\-]?[\d.,]+\s*€[^\n]*\n\s*([\d.,]+)\.\.\.\s*\n\s*([\d.,]+)\s*€\s*\n\s*[\d.,]+\s*€\s*\n\s*[\d.,]+\s*€/gi
  for (const match of normalized.matchAll(blockRegex)) {
    const merged = match[1].replace(/\s+/g, ' ').trim()
    const split = merged.match(/^([A-Z0-9.\-]{2,10})([A-ZÀ-ÖØ-Þ].*)$/u)
    const ticker = split ? split[1] : undefined
    const instrumentName = (split ? split[2] : merged).trim()
    const quantity = parseFrenchNumber(match[2])
    const marketPrice = parseFrenchNumber(match[3])
    if (!instrumentName || !quantity || !marketPrice || marketPrice <= 0) continue
    parsed.push({ ticker, instrumentName, quantity, marketPrice })
  }

  if (parsed.length > 0) return parsed

  for (const row of rows) {
    const columns = row.split('\t').map((item) => item.trim())
    if (columns.length < 5) continue
    const first = columns[0].toLowerCase()
    if (first === 'entreprise' || first.includes('vos avoirs')) continue

    const firstCell = columns[0]
    const firstCellParts = firstCell.split(/\s{2,}|\n/).map((item) => item.trim()).filter(Boolean)
    const tickerCandidate = firstCellParts[0]
    const ticker = /^[A-Z0-9.\-]{1,12}$/.test(tickerCandidate) ? tickerCandidate : undefined
    const instrumentName = (ticker && firstCellParts.length > 1 ? firstCellParts.slice(1).join(' ') : firstCell).trim()
    const quantity = parseFrenchNumber(columns[3])
    const marketPrice = parseFrenchNumber(columns[4])

    if (!instrumentName || !quantity || !marketPrice || marketPrice <= 0) continue
    parsed.push({ ticker, instrumentName, quantity, marketPrice })
  }

  return parsed
}

function parseIgCashHistoryPaste(raw: string): Array<{ kind: 'Dépôt' | 'Retrait'; amount: number; occurredOn: string }> {
  const normalized = raw
    .replace(/\u00A0/g, ' ')
    .replace(/(\d{2}\/\d{2}\/\d{4})(\d{2}:\d{2})/g, '$1 $2')
  const rows: Array<{ kind: 'Dépôt' | 'Retrait'; amount: number; occurredOn: string }> = []

  const regex = /(Dépôt|Acheter)\s*\n\s*([+\-]?[\d.,]+)\s*€\s*\n\s*(\d{2}\/\d{2}\/\d{4})/gi
  for (const match of normalized.matchAll(regex)) {
    const verb = match[1]
    const amount = parseFrenchNumber(match[2])
    const occurredOn = toIsoDate(match[3])
    if (amount === undefined || !occurredOn) continue
    const isDeposit = /dépôt/i.test(verb) && amount > 0
    rows.push({ kind: isDeposit ? 'Dépôt' : 'Retrait', amount: Math.abs(amount), occurredOn })
  }

  return rows
}

function parseIgOrderStatementPdfText(raw: string, kind: 'Achat' | 'Vente'): Array<{ instrumentName: string; isin?: string; quantity: number; grossAmount: number; unitPrice?: number; occurredOn: string; kind: TransactionKind }> {
  const normalized = raw.replace(/\u00A0/g, ' ')
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  let instrumentName: string | undefined
  const titleIndex = lines.findIndex((line) => /^Titre$/i.test(line))
  if (titleIndex >= 0) {
    for (let i = titleIndex + 1; i < lines.length; i += 1) {
      const candidate = lines[i]
      if (/^ISIN$/i.test(candidate)) break
      if (!candidate || /^Titre$/i.test(candidate)) continue
      instrumentName = candidate
      break
    }
  }

  if (!instrumentName) {
    const fallbackTitleMatch = normalized.match(/\bTitre\b\s+([^\n]+)/i)
    instrumentName = fallbackTitleMatch?.[1]?.trim()
  }

  const isinMatch = normalized.match(/\bISIN\b\s+([A-Z]{2}[A-Z0-9]{10})\b/i)
  const quantityMatch = normalized.match(/Valeur\s+nominale\s*\/\s*Quantité\s+([\d.,]+)\s+unit/i)
  const priceMatch = normalized.match(/\bPrix\b\s+([\d.,]+)\s+EUR\b/i)
  const debitMatch = normalized.match(/Montant\s+débité\s+([\d.,]+)\s+EUR\b/i)
  const creditMatch = normalized.match(/Montant\s+crédité\s+([\d.,]+)\s+EUR\b/i)
  const valueDateMatch = normalized.match(/Date\s+de\s+valeur\s+(\d{2}\.\d{2}\.\d{4})\b/i)
  const operationDateMatch = normalized.match(/Heure\s+d['’]Opération:\s*(\d{2}\.\d{2}\.\d{4})\b/i)

  const quantity = quantityMatch ? parseFrenchNumber(quantityMatch[1]) : undefined
  const unitPrice = priceMatch ? parseFrenchNumber(priceMatch[1]) : undefined
  const grossAmount = debitMatch
    ? parseFrenchNumber(debitMatch[1])
    : creditMatch
      ? parseFrenchNumber(creditMatch[1])
      : quantity && unitPrice
        ? quantity * unitPrice
        : undefined

  const occurredOn = toIsoDate((valueDateMatch?.[1] ?? operationDateMatch?.[1] ?? '').replace(/\./g, '/'))
  const isin = isinMatch?.[1]
  instrumentName = instrumentName?.trim()

  if (!instrumentName || !quantity || !grossAmount || !occurredOn) return []

  return [{
    instrumentName,
    isin,
    quantity,
    grossAmount,
    unitPrice,
    occurredOn,
    kind,
  }]
}

function findPositionForHoldingRow(activePositions: Array<{ id: string; ticker?: string; name: string }>, row: { ticker?: string; instrumentName: string; quantity: number; marketPrice: number }) {
  if (row.ticker) {
    const byTicker = activePositions.find((position) => (position.ticker ?? '').toUpperCase() === row.ticker?.toUpperCase())
    if (byTicker) return byTicker
  }

  const rowName = normalizeLabel(row.instrumentName)
  let bestMatch: { id: string; ticker?: string; name: string } | undefined
  let bestScore = 0

  for (const position of activePositions) {
    const candidate = normalizeLabel(position.name)
    if (!candidate || !rowName) continue
    if (candidate === rowName) return position
    if (candidate.includes(rowName) || rowName.includes(candidate)) {
      const score = Math.min(candidate.length, rowName.length)
      if (score > bestScore) {
        bestScore = score
        bestMatch = position
      }
    }
  }

  return bestMatch
}

async function extractTextFromPdfFile(file: File): Promise<string> {
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()
  }

  const buffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const text = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('\n')
    pages.push(text)
  }

  return pages.join('\n')
}

function detectIgPdfType(fileName: string): 'QUARTERLY' | 'ACCOUNT_OPENING' | 'ORDER_EX_ANTE_COST' | 'CANCELLED_ORDER' | 'BUY_ORDER' | 'SELL_ORDER' | 'UNKNOWN' {
  const normalized = fileName.toUpperCase()
  if (normalized.includes('REPORT_TYPE_QUARTERLY_ACCOUNT_STATEMENT')) return 'QUARTERLY'
  if (normalized.includes('REPORT_TYPE_ACCOUNT_OPENING')) return 'ACCOUNT_OPENING'
  if (normalized.includes('REPORT_TYPE_BUY_ORDER')) return 'BUY_ORDER'
  if (normalized.includes('REPORT_TYPE_SELL_ORDER')) return 'SELL_ORDER'
  if (normalized.includes('REPORT_TYPE_ORDER_EX_ANTE_COST')) return 'ORDER_EX_ANTE_COST'
  if (normalized.includes('REPORT_TYPE_CANCELLED_ORDER')) return 'CANCELLED_ORDER'
  return 'UNKNOWN'
}

export default App