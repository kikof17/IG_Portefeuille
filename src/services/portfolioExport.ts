import * as XLSX from 'xlsx'
import type { PortfolioData } from '../domain/portfolio'
import { calculatePortfolio } from './portfolioCalculation'

export function transactionsCsv(data: PortfolioData): string {
  const rows = [['Date', 'Type', 'Instrument', 'Ticker', 'ISIN', 'Classe', 'Quantité', 'Montant brut', 'Frais', 'Flux', 'Statut']]
  for (const transaction of data.transactions) rows.push([transaction.occurredOn, transaction.kind, transaction.instrumentName, transaction.ticker ?? '', transaction.isin ?? '', transaction.assetClass, transaction.quantity?.toString() ?? '', transaction.grossAmount.toString(), transaction.fees.toString(), transaction.cashFlow.toString(), transaction.cancelledAt ? 'Annulée' : 'Active'])
  return rows.map((row) => row.map(csvCell).join(';')).join('\n')
}

export function downloadTransactionsCsv(data: PortfolioData): void {
  const blob = new Blob(['\uFEFF', transactionsCsv(data)], { type: 'text/csv;charset=utf-8' })
  download(blob, `journal-${fileDate()}.csv`)
}

export function downloadPortfolioWorkbook(data: PortfolioData): void {
  const snapshot = calculatePortfolio(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.transactions), 'Journal')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(snapshot.positions), 'Positions')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(snapshot.allocation), 'Allocation')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.auditLog ?? []), 'Audit')
  XLSX.writeFile(workbook, `portefeuille-${fileDate()}.xlsx`)
}

function csvCell(value: string): string { return /[;"\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value }
function fileDate(): string { return new Date().toISOString().slice(0, 10) }
function download(blob: Blob, fileName: string): void { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url) }