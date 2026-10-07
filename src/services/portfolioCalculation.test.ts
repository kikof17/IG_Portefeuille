import { describe, expect, it } from 'vitest'
import type { PortfolioData, Transaction } from '../domain/portfolio'
import { calculatePortfolio, calculateQdfHoldings } from './portfolioCalculation'

const baseData = (transactions: Transaction[]): PortfolioData => ({
  schemaVersion: 1, createdAt: '2026-10-07T00:00:00.000Z', transactions,
  allocationTargets: [{ assetClass: 'ETF Monde', targetWeight: 0.65 }, { assetClass: 'ETF Small Caps', targetWeight: 0.1 }, { assetClass: 'Actions individuelles', targetWeight: 0.1 }, { assetClass: 'ETF Maison', targetWeight: 0.1 }],
  rebalancingRules: { minimumCashWeight: 0.05, minimumOrderAmount: 10, targetIndividualStockCount: 3 }, qdfConstituents: [],
})

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  id: crypto.randomUUID(), occurredOn: '2026-01-01', kind: 'Achat', instrumentName: 'ETF Test', ticker: 'TEST', isin: 'TEST000001', quantity: 1, unitPrice: 100, grossAmount: 100, fees: 0, cashFlow: -100, assetClass: 'ETF Monde', ...overrides,
})

describe('calculatePortfolio', () => {
  it('calcule le cash, le PRU frais inclus et la position nette après une vente', () => {
    const snapshot = calculatePortfolio(baseData([
      transaction({ id: 'deposit', occurredOn: '2026-01-01', kind: 'Dépôt', instrumentName: 'Espèces', ticker: 'CASH', quantity: undefined, grossAmount: 300, cashFlow: 300, assetClass: 'Non classé' }),
      transaction({ id: 'buy-1', occurredOn: '2026-01-02', quantity: 1, unitPrice: 100, grossAmount: 100, fees: 2, cashFlow: -102 }),
      transaction({ id: 'buy-2', occurredOn: '2026-01-03', quantity: 1, unitPrice: 120, grossAmount: 120, fees: 0, cashFlow: -120 }),
      transaction({ id: 'sell', occurredOn: '2026-01-04', kind: 'Vente', quantity: 0.5, unitPrice: 125, grossAmount: 62.5, fees: 1, cashFlow: 61.5 }),
    ]))

    expect(snapshot.cash).toBe(139.5)
    expect(snapshot.positions).toHaveLength(1)
    expect(snapshot.positions[0]).toMatchObject({ quantity: 1.5, averageCost: 111, costBasis: 166.5, marketValue: 187.5 })
    expect(snapshot.totalValue).toBe(327)
  })

  it('ne suggère pas un ordre inférieur au minimum configuré', () => {
    const snapshot = calculatePortfolio(baseData([
      transaction({ id: 'deposit', kind: 'Dépôt', instrumentName: 'Espèces', ticker: 'CASH', quantity: undefined, grossAmount: 200, cashFlow: 200, assetClass: 'Non classé' }),
      transaction({ id: 'buy', grossAmount: 150, quantity: 1.5, unitPrice: 100, cashFlow: -150 }),
    ]))

    expect(snapshot.investableCash).toBe(40)
    expect(snapshot.rebalancing.every((item) => item.suggestedAmount === 0 || item.suggestedAmount >= 10)).toBe(true)
  })

  it('privilégie un cours saisi localement au dernier cours de transaction', () => {
    const data = baseData([transaction({ id: 'buy', quantity: 2, unitPrice: 100, grossAmount: 200, cashFlow: -200 })])
    data.marketPrices = { TEST000001: { value: 125, updatedAt: '2026-10-07T12:00:00.000Z' } }

    const position = calculatePortfolio(data).positions[0]

    expect(position).toMatchObject({ marketPrice: 125, marketValue: 250, priceSource: 'Cours saisi' })
  })

  it('agrège les lignes QDF avec les cours saisis localement', () => {
    const data = baseData([transaction({ id: 'qdf-buy', ticker: 'QDFX', isin: 'QDF000001', instrumentName: 'Société QDF', assetClass: 'ETF Maison', quantity: 2, unitPrice: 10, grossAmount: 20, cashFlow: -20 })])
    data.qdfConstituents = [{ status: 'Actif', rank: 1, company: 'Société QDF', ticker: 'QDFX', targetWeight: 1, marketPrice: 12 }]

    const holdings = calculateQdfHoldings(data)
    const snapshot = calculatePortfolio(data)

    expect(holdings[0]).toMatchObject({ ticker: 'QDFX', marketPrice: 12, marketValue: 24, priceSource: 'Cours saisi' })
    expect(snapshot.positions.find((position) => position.id === 'QDF')).toMatchObject({ marketValue: 24, costBasis: 20 })
  })

  it('ignore une opération annulée sans la supprimer du journal', () => {
    const snapshot = calculatePortfolio(baseData([
      transaction({ id: 'deposit', kind: 'Dépôt', instrumentName: 'Espèces', quantity: undefined, grossAmount: 100, cashFlow: 100, assetClass: 'Non classé' }),
      transaction({ id: 'cancelled-buy', quantity: 1, grossAmount: 50, unitPrice: 50, cashFlow: -50, cancelledAt: '2026-01-02T10:00:00.000Z' }),
    ]))

    expect(snapshot.cash).toBe(100)
    expect(snapshot.positions).toHaveLength(0)
  })
})