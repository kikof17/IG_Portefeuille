export type TransactionKind = 'Achat' | 'Vente' | 'Dépôt' | 'Dividende' | 'Frais' | 'Autre'

export type AssetClass =
  | 'ETF Monde'
  | 'ETF Small Caps'
  | 'Actions individuelles'
  | 'ETF Maison'
  | 'Liquidités'
  | 'Non classé'

export interface Transaction {
  id: string
  occurredOn: string
  kind: TransactionKind
  contributionKind?: string
  source?: string
  instrumentName: string
  ticker?: string
  isin?: string
  quantity?: number
  unitPrice?: number
  grossAmount: number
  fees: number
  cashFlow: number
  assetClass: AssetClass
  note?: string
  cancelledAt?: string
  cancellationReason?: string
}

export interface MarketPrice {
  value: number
  updatedAt: string
}

export interface AllocationTarget {
  assetClass: AssetClass
  targetWeight: number
}

export interface RebalancingRules {
  minimumCashWeight: number
  minimumOrderAmount: number
  targetIndividualStockCount: number
}

export interface QdfConstituent {
  status: string
  rank?: number
  company: string
  ticker: string
  isin?: string
  sector?: string
  targetWeight: number
  marketPrice?: number
  note?: string
}

export interface PortfolioHistoryPoint {
  id: string
  recordedAt: string
  totalValue: number
  cash: number
}

export interface PortfolioData {
  schemaVersion: number
  createdAt: string
  transactions: Transaction[]
  marketPrices?: Record<string, MarketPrice>
  allocationTargets: AllocationTarget[]
  rebalancingRules: RebalancingRules
  qdfConstituents: QdfConstituent[]
  history?: PortfolioHistoryPoint[]
  auditLog?: AuditEntry[]
}

export interface AuditEntry {
  id: string
  occurredAt: string
  action: 'create' | 'update' | 'price' | 'cancel'
  detail: string
  transactionId?: string
}

