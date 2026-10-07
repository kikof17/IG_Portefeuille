import { describe, expect, it } from 'vitest'
import type { PortfolioData } from '../domain/portfolio'
import { recordPortfolioHistory } from './portfolioLifecycle'

const data: PortfolioData = {
  schemaVersion: 1,
  createdAt: '2026-10-07T00:00:00.000Z',
  transactions: [],
  allocationTargets: [{ assetClass: 'ETF Monde', targetWeight: 0.65 }, { assetClass: 'ETF Small Caps', targetWeight: 0.1 }, { assetClass: 'Actions individuelles', targetWeight: 0.1 }, { assetClass: 'ETF Maison', targetWeight: 0.1 }],
  rebalancingRules: { minimumCashWeight: 0.05, minimumOrderAmount: 10, targetIndividualStockCount: 3 },
  qdfConstituents: [],
}

describe('recordPortfolioHistory', () => {
  it('conserve un point lors d’une nouvelle valorisation et ignore les doublons', () => {
    const first = recordPortfolioHistory(data)
    const duplicate = recordPortfolioHistory(first)
    const changed = recordPortfolioHistory({ ...first, transactions: [{ id: 'deposit', occurredOn: '2026-10-07', kind: 'Dépôt', instrumentName: 'Espèces', grossAmount: 100, fees: 0, cashFlow: 100, assetClass: 'Liquidités' }] })

    expect(first.history).toHaveLength(1)
    expect(duplicate.history).toHaveLength(1)
    expect(changed.history).toHaveLength(2)
    expect(changed.history?.at(-1)).toMatchObject({ totalValue: 100, cash: 100 })
  })
})
