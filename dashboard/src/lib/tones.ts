// Palette slots (s1..s5 in index.css) for categorical series, so a region or category keeps its colour on every page.
const SLOTS = ['s1', 's2', 's4', 's3', 's5']

export function toneOf(list: string[], value: string) {
  const i = list.indexOf(value)
  return SLOTS[(i < 0 ? 0 : i) % SLOTS.length]
}
