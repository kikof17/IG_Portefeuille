import type { AuditEntry, PortfolioData } from '../domain/portfolio'
import { calculatePortfolio } from './portfolioCalculation'

export function addAuditEntry(data: PortfolioData, entry: Omit<AuditEntry, 'id' | 'occurredAt'>): PortfolioData {
  const audit: AuditEntry = { id: crypto.randomUUID(), occurredAt: new Date().toISOString(), ...entry }
  return { ...data, auditLog: [...(data.auditLog ?? []), audit] }
}

export function recordPortfolioHistory(data: PortfolioData): PortfolioData {
  const snapshot = calculatePortfolio(data)
  const recordedAt = new Date().toISOString()
  const lastPoint = data.history?.at(-1)
  if (lastPoint && lastPoint.totalValue === snapshot.totalValue && lastPoint.cash === snapshot.cash) return data
  return { ...data, history: [...(data.history ?? []), { id: crypto.randomUUID(), recordedAt, totalValue: snapshot.totalValue, cash: snapshot.cash }] }
}
