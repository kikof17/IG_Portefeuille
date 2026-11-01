import type { AllocationTarget, AssetClass, PortfolioData, Transaction } from '../domain/portfolio'

export interface CalculatedPosition {
  id: string
  name: string
  ticker?: string
  isin?: string
  assetClass: AssetClass
  quantity: number
  averageCost: number
  marketPrice: number
  costBasis: number
  marketValue: number
  gainLoss: number
  gainLossRate: number
  priceSource: 'Cours saisi' | 'Dernière opération'
}

export interface AllocationLine {
  assetClass: AssetClass
  value: number
  weight: number
  targetWeight: number
  targetValue: number
  difference: number
}

export interface RebalancingSuggestion {
  assetClass: AssetClass
  currentValue: number
  currentWeight: number
  targetWeight: number
  deficit: number
  suggestedAmount: number
}

export interface PortfolioSnapshot {
  positions: CalculatedPosition[]
  cash: number
  totalValue: number
  totalCostBasis: number
  unrealizedGainLoss: number
  allocation: AllocationLine[]
  cashTarget: number
  investableCash: number
  rebalancing: RebalancingSuggestion[]
}

const cashAssetClass: AssetClass = 'Liquidités'

export function calculatePortfolio(data: PortfolioData): PortfolioSnapshot {
  const activeTransactions = data.transactions.filter((transaction) => !transaction.cancelledAt)
  const standardTransactions = activeTransactions.filter((transaction) => isSecurityTransaction(transaction) && transaction.assetClass !== 'ETF Maison')
  const qdfTransactions = activeTransactions.filter((transaction) => isSecurityTransaction(transaction) && transaction.assetClass === 'ETF Maison')
  const positions = calculateSecurityPositions(standardTransactions, data)
  const qdfPosition = calculateQdfPosition(qdfTransactions, data)
  if (qdfPosition) positions.push(qdfPosition)

  const cash = roundCurrency(activeTransactions.reduce((total, transaction) => total + transaction.cashFlow, 0))
  const investedValue = positions.reduce((total, position) => total + position.marketValue, 0)
  const netValue = investedValue + cash
  const totalValue = roundCurrency(investedValue > 0 ? Math.max(netValue, investedValue) : Math.max(netValue, 0))
  const totalCostBasis = roundCurrency(positions.reduce((total, position) => total + position.costBasis, 0))
  const unrealizedGainLoss = roundCurrency(positions.reduce((total, position) => total + position.gainLoss, 0))
  const allocation = calculateAllocation(positions, cash, totalValue, data.allocationTargets, data.rebalancingRules.minimumCashWeight)
  const cashTarget = roundCurrency(totalValue * data.rebalancingRules.minimumCashWeight)
  const investableCash = roundCurrency(Math.max(cash - cashTarget, 0))
  const rebalancing = calculateRebalancing(allocation, investableCash, data.rebalancingRules.minimumOrderAmount)

  return { positions, cash, totalValue, totalCostBasis, unrealizedGainLoss, allocation, cashTarget, investableCash, rebalancing }
}

export function calculateQdfHoldings(data: PortfolioData): CalculatedPosition[] {
  const qdfTransactions = data.transactions.filter((transaction) => !transaction.cancelledAt && isSecurityTransaction(transaction) && transaction.assetClass === 'ETF Maison')
  const marketPrices = new Map(data.qdfConstituents.map((constituent) => [constituent.ticker, constituent.marketPrice]))
  return calculateSecurityPositions(qdfTransactions, data).map((position) => {
    const marketPrice = data.marketPrices?.[position.id]?.value ?? marketPrices.get(position.ticker ?? '') ?? position.marketPrice
    const marketValue = position.quantity * marketPrice
    return { ...position, marketPrice, marketValue, gainLoss: marketValue - position.costBasis, gainLossRate: position.costBasis === 0 ? 0 : (marketValue - position.costBasis) / position.costBasis, priceSource: (data.marketPrices?.[position.id] || marketPrices.has(position.ticker ?? '')) ? 'Cours saisi' as const : 'Dernière opération' as const }
  })
}

function isSecurityTransaction(transaction: Transaction): boolean {
  return (transaction.kind === 'Achat' || transaction.kind === 'Vente') && Boolean(transaction.quantity)
}

function calculateSecurityPositions(transactions: Transaction[], data: PortfolioData): CalculatedPosition[] {
  const buckets = new Map<string, Transaction[]>()
  for (const transaction of transactions) {
    const key = transaction.isin || transaction.ticker || transaction.instrumentName
    buckets.set(key, [...(buckets.get(key) ?? []), transaction])
  }

  return [...buckets.entries()].flatMap(([id, bucket]) => {
    const purchases = bucket.filter((transaction) => transaction.kind === 'Achat')
    const sells = bucket.filter((transaction) => transaction.kind === 'Vente')
    const purchasedQuantity = sum(purchases, (transaction) => transaction.quantity ?? 0)
    const soldQuantity = sum(sells, (transaction) => transaction.quantity ?? 0)
    const quantity = purchasedQuantity - soldQuantity
    if (quantity <= 0 || purchasedQuantity <= 0) return []

    const purchaseAmount = sum(purchases, (transaction) => transaction.grossAmount + transaction.fees)
    const averageCost = purchaseAmount / purchasedQuantity
    const latestTransaction = [...bucket].sort((left, right) => right.occurredOn.localeCompare(left.occurredOn))[0]
    const assetClass = dominantAssetClass(purchases)
    const marketPrice = dataPrice(data, id) ?? latestTransaction.unitPrice ?? averageCost
    const costBasis = quantity * averageCost
    const marketValue = quantity * marketPrice
    return [{
      id,
      name: latestTransaction.instrumentName,
      ticker: latestTransaction.ticker,
      isin: latestTransaction.isin,
      assetClass,
      quantity,
      averageCost,
      marketPrice,
      costBasis,
      marketValue,
      gainLoss: marketValue - costBasis,
      gainLossRate: costBasis === 0 ? 0 : (marketValue - costBasis) / costBasis,
      priceSource: dataPrice(data, id) === undefined ? 'Dernière opération' : 'Cours saisi',
    }]
  })
}

function calculateQdfPosition(transactions: Transaction[], data: PortfolioData): CalculatedPosition | undefined {
  if (transactions.length === 0) return undefined
  const positions = calculateQdfHoldings(data)
  const quantity = positions.reduce((total, position) => total + position.quantity, 0)
  const costBasis = positions.reduce((total, position) => total + position.costBasis, 0)
  const marketValue = positions.reduce((total, position) => total + position.marketValue, 0)
  return {
    id: 'QDF', name: 'QDF · Qualité Décotée France', ticker: 'QDF', assetClass: 'ETF Maison', quantity,
    averageCost: quantity === 0 ? 0 : costBasis / quantity,
    marketPrice: quantity === 0 ? 0 : marketValue / quantity,
    costBasis, marketValue, gainLoss: marketValue - costBasis,
    gainLossRate: costBasis === 0 ? 0 : (marketValue - costBasis) / costBasis,
    priceSource: 'Cours saisi',
  }
}

function calculateAllocation(positions: CalculatedPosition[], cash: number, totalValue: number, targets: AllocationTarget[], cashTarget: number): AllocationLine[] {
  const assetClasses: AssetClass[] = ['ETF Monde', 'ETF Small Caps', 'Actions individuelles', 'ETF Maison', 'Non classé', cashAssetClass]
  return assetClasses.map((assetClass) => {
    const value = assetClass === cashAssetClass ? cash : positions.filter((position) => position.assetClass === assetClass).reduce((total, position) => total + position.marketValue, 0)
    const targetWeight = assetClass === cashAssetClass ? cashTarget : targets.find((target) => target.assetClass === assetClass)?.targetWeight ?? 0
    const targetValue = totalValue * targetWeight
    return { assetClass, value: roundCurrency(value), weight: totalValue === 0 ? 0 : value / totalValue, targetWeight, targetValue: roundCurrency(targetValue), difference: roundCurrency(value - targetValue) }
  })
}

function calculateRebalancing(allocation: AllocationLine[], investableCash: number, minimumOrderAmount: number): RebalancingSuggestion[] {
  const candidates = allocation.filter((line) => line.assetClass !== cashAssetClass && line.difference < 0)
  const totalDeficit = candidates.reduce((total, line) => total + Math.abs(line.difference), 0)
  return candidates.map((line) => {
    const suggestedAmount = totalDeficit === 0 ? 0 : Math.min(Math.abs(line.difference), investableCash * Math.abs(line.difference) / totalDeficit)
    return { assetClass: line.assetClass, currentValue: line.value, currentWeight: line.weight, targetWeight: line.targetWeight, deficit: Math.abs(line.difference), suggestedAmount: roundCurrency(suggestedAmount >= minimumOrderAmount ? suggestedAmount : 0) }
  }).sort((left, right) => right.deficit - left.deficit)
}

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0)
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function dominantAssetClass(purchases: Transaction[]): AssetClass {
  const purchasedAmountByClass = new Map<AssetClass, number>()
  for (const purchase of purchases) {
    purchasedAmountByClass.set(purchase.assetClass, (purchasedAmountByClass.get(purchase.assetClass) ?? 0) + purchase.grossAmount)
  }
  return [...purchasedAmountByClass.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'Non classé'
}

function dataPrice(data: PortfolioData, instrumentId: string): number | undefined {
  const value = data.marketPrices?.[instrumentId]?.value
  return value && value > 0 ? value : undefined
}