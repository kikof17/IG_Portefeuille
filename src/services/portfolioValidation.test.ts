import { describe, expect, it } from 'vitest'
import type { PortfolioData } from '../domain/portfolio'
import { validatePortfolio } from './portfolioValidation'

const data: PortfolioData = { schemaVersion: 1, createdAt: '', allocationTargets: [], rebalancingRules: { minimumCashWeight: 0.05, minimumOrderAmount: 10, targetIndividualStockCount: 3 }, qdfConstituents: [], transactions: [{ id: 'buy', occurredOn: '2026-01-01', kind: 'Achat', instrumentName: 'Instrument', ticker: 'ABC', quantity: 1, grossAmount: 10, fees: 0, cashFlow: -10, assetClass: 'ETF Monde' }, { id: 'sell', occurredOn: '2026-01-02', kind: 'Vente', instrumentName: 'Instrument', ticker: 'ABC', quantity: 2, grossAmount: 20, fees: 0, cashFlow: 20, assetClass: 'Actions individuelles' }] }

describe('validatePortfolio', () => {
  it('détecte les ventes excédentaires et l’ISIN manquant', () => {
    const titles = validatePortfolio(data).map((issue) => issue.title)
    expect(titles).toContain('ISIN manquant')
    expect(titles).not.toContain('Classe d’actif incohérente')
    expect(titles).toContain('Quantité vendue supérieure aux achats')
  })

  it('détecte un doublon probable', () => {
    const duplicated = { ...data, transactions: [data.transactions[0], { ...data.transactions[0], id: 'buy-copy' }] }
    expect(validatePortfolio(duplicated).map((issue) => issue.title)).toContain('Doublon potentiel')
  })
})