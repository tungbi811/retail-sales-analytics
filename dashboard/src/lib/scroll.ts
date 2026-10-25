/** Scrolls to a card further down the page. */
export function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
