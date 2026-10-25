/** Save rows as a CSV file. Cells with commas, quotes or line breaks are quoted. */
export function downloadCsv(name: string, columns: string[], rows: Record<string, unknown>[]) {
  const cell = (v: unknown) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const csv = [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
