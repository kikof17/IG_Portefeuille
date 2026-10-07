import type { PortfolioData, Transaction } from '../domain/portfolio'

export type ValidationSeverity = 'error' | 'warning'

export interface PortfolioIssue {
  id: string
  severity: ValidationSeverity
  title: string
  detail: string
  transactionIds: string[]
}

export function validatePortfolio(data: PortfolioData): PortfolioIssue[] {
  const issues: PortfolioIssue[] = []
  const activeTransactions = data.transactions.filter((transaction) => !transaction.cancelledAt)
  const transactionsByInstrument = groupByInstrument(activeTransactions)

  for (const [instrument, transactions] of transactionsByInstrument) {
    const purchases = transactions.filter((transaction) => transaction.kind === 'Achat')
    const sales = transactions.filter((transaction) => transaction.kind === 'Vente')
    const boughtQuantity = sum(purchases, (transaction) => transaction.quantity ?? 0)
    const soldQuantity = sum(sales, (transaction) => transaction.quantity ?? 0)
    const isSecurity = purchases.length > 0 || sales.length > 0

    if (isSecurity && !transactions.some((transaction) => transaction.isin)) {
      issues.push(issue('warning', 'ISIN manquant', `${instrument} ne possède pas d’ISIN. Le rapprochement futur avec IG sera moins fiable.`, transactions))
    }
    if (soldQuantity > boughtQuantity + 1e-9) {
      issues.push(issue('error', 'Quantité vendue supérieure aux achats', `${instrument} a ${soldQuantity.toFixed(4)} unité(s) vendue(s) pour ${boughtQuantity.toFixed(4)} achetée(s).`, transactions))
    }
  }

  for (const transaction of activeTransactions) {
    if ((transaction.kind === 'Achat' || transaction.kind === 'Vente') && (!transaction.quantity || transaction.quantity <= 0)) {
      issues.push(issue('error', 'Quantité invalide', `${transaction.instrumentName} possède une opération ${transaction.kind.toLowerCase()} sans quantité positive.`, [transaction]))
    }
    if ((transaction.kind === 'Achat' || transaction.kind === 'Vente') && transaction.grossAmount <= 0) {
      issues.push(issue('error', 'Montant invalide', `${transaction.instrumentName} possède un montant brut nul ou négatif.`, [transaction]))
    }
  }

  const identifiersByLabel = new Map<string, Transaction[]>()
  for (const transaction of activeTransactions.filter((transaction) => transaction.ticker || transaction.isin)) {
    const key = (transaction.ticker ?? transaction.instrumentName).trim().toUpperCase()
    identifiersByLabel.set(key, [...(identifiersByLabel.get(key) ?? []), transaction])
  }
  for (const [label, transactions] of identifiersByLabel) {
    const isins = new Set(transactions.map((transaction) => transaction.isin).filter(Boolean))
    if (isins.size > 1) issues.push(issue('warning', 'ISIN incohérents', `${label} est associé à plusieurs ISIN : ${[...isins].join(', ')}.`, transactions))
  }
  const fingerprints = new Map<string, Transaction[]>()
  for (const transaction of activeTransactions) {
    const fingerprint = [transaction.occurredOn, transaction.kind, transaction.isin ?? transaction.ticker ?? transaction.instrumentName, transaction.quantity ?? '', transaction.grossAmount, transaction.fees].join('|')
    fingerprints.set(fingerprint, [...(fingerprints.get(fingerprint) ?? []), transaction])
  }
  for (const transactions of fingerprints.values()) {
    if (transactions.length > 1) issues.push(issue('warning', 'Doublon potentiel', `${transactions.length} opérations possèdent la même date, le même instrument et le même montant.`, transactions))
  }

  const allocationTotal = data.allocationTargets.reduce((total, target) => total + target.targetWeight, 0) + data.rebalancingRules.minimumCashWeight
  if (Math.abs(allocationTotal - 1) > 0.0001) {
    issues.push({ id: 'allocation-total', severity: 'error', title: 'Allocation cible incomplète', detail: `La somme des cibles est ${(allocationTotal * 100).toFixed(2)} % au lieu de 100 %.`, transactionIds: [] })
  }
  const activeQdf = data.qdfConstituents.filter((constituent) => constituent.status === 'Actif')
  const missingQdfPrice = activeQdf.filter((constituent) => !constituent.marketPrice || constituent.marketPrice <= 0)
  if (missingQdfPrice.length > 0) {
    issues.push({ id: 'qdf-price', severity: 'warning', title: 'Cours QDF manquant', detail: `${missingQdfPrice.map((constituent) => constituent.ticker).join(', ')} n’a pas de cours positif. La dernière opération sera utilisée comme estimation.`, transactionIds: [] })
  }
  const qdfWeightTotal = sum(activeQdf, (constituent) => constituent.targetWeight)
  if (activeQdf.length > 0 && Math.abs(qdfWeightTotal - 1) > 0.0001) {
    issues.push({ id: 'qdf-weights', severity: 'warning', title: 'Répartition QDF incomplète', detail: `La somme des poids cibles QDF est ${(qdfWeightTotal * 100).toFixed(2)} % au lieu de 100 %.`, transactionIds: [] })
  }
  return issues
}

function groupByInstrument(transactions: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>()
  for (const transaction of transactions) {
    const key = transaction.isin || transaction.ticker || transaction.instrumentName
    groups.set(key, [...(groups.get(key) ?? []), transaction])
  }
  return groups
}

function issue(severity: ValidationSeverity, title: string, detail: string, transactions: Transaction[]): PortfolioIssue {
  return { id: `${severity}-${title}-${transactions.map((transaction) => transaction.id).join('-')}`, severity, title, detail, transactionIds: transactions.map((transaction) => transaction.id) }
}

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0)
}