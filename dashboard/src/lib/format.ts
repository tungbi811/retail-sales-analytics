const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

// Amounts carry a currency only when the warehouse records one; the gold models do not,
// so live data shows plain numbers instead of a guessed symbol.
let symbol = ''
let money0 = int

export function setCurrency(code: string | null) {
  money0 = code ? new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 }) : int
  symbol = code ? (money0.formatToParts(0).find((p) => p.type === 'currency')?.value ?? '') : ''
}

export const money = (n: number) => money0.format(n)
export const count = (n: number) => int.format(n)

/** 19.1k style, for axes and compact labels. */
export function moneyShort(n: number) {
  if (n >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`
  if (n >= 10_000) return `${symbol}${Math.round(n / 1000)}k`
  if (n >= 1000) return `${symbol}${(n / 1000).toFixed(1)}k`
  return `${symbol}${Math.round(n)}`
}

export function signedPct(n: number, digits = 1) {
  const v = n.toFixed(digits)
  return n > 0 ? `+${v}%` : `${v.replace('-', '−')}%`
}

export function dayMonth(d: Date) {
  return d.toLocaleString('en', { day: 'numeric', month: 'short' })
}

export function time(d: Date) {
  return d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** "06:00 today", "23:55 yesterday" or "24 Oct, 06:00". */
export function when(d: Date, now = new Date()) {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86_400_000)
  if (diff === 0) return `${time(d)} today`
  if (diff === 1) return `${time(d)} yesterday`
  return `${dayMonth(d)}, ${time(d)}`
}

/** Axis maximum on a 1-1.5-2-2.5-3-4-5-6-8 step, split into four gridlines. */
export function niceMax(v: number) {
  const raw = v / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((s) => s >= raw)!
  return step * 4
}
