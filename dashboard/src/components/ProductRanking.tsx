import type { ProductStat } from '../data/analytics'
import { count, money } from '../lib/format'
import { Info } from './Info'

interface Props {
  products: ProductStat[]
  category: string
  /** "Up to Jul 27 2024" */
  span: string
  onSelect: (id: string) => void
}

const SHOWN = 5

/** Products ranked by revenue to date, with the rest summed in one row. */
export function ProductRanking({ products, category, span, onSelect }: Props) {
  const ranked = products.filter((p) => p.orders > 0).sort((a, b) => b.revenue - a.revenue || a.product_name.localeCompare(b.product_name))
  const total = ranked.reduce((sum, p) => sum + p.revenue, 0)
  const rest = ranked.slice(SHOWN)
  const restRevenue = rest.reduce((sum, p) => sum + p.revenue, 0)
  const share = (n: number) => `${Math.round(total ? (n / total) * 100 : 0)}%`

  return (
    <section className="card product-ranking" aria-labelledby="ranking-title">
      <h2 className="card-title" id="ranking-title">
        Top products <Info text="Each product's revenue from the first sale to the last, for the selected region and category. Share is of the products listed." />
      </h2>
      <p className="ranking-span">
        {category === 'All' ? 'All products' : category} · {span}
      </p>

      {ranked.length === 0 ? (
        <p className="ranking-empty">No sales yet.</p>
      ) : (
        <>
          <table className="ranking-table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Units</th>
                <th scope="col">Revenue</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, SHOWN).map((p) => (
                <tr key={p.product_id}>
                  <th scope="row">
                    <button className="ranking-name" onClick={() => onSelect(p.product_id)}>
                      {p.product_name}
                    </button>
                  </th>
                  <td className="ranking-units">{count(p.units)}</td>
                  <td className="ranking-revenue">{money(p.revenue)}</td>
                  <td className="ranking-share">{share(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
            {rest.length > 0 && (
              <tfoot>
                <tr>
                  <th scope="row">Other products ({rest.length})</th>
                  <td className="ranking-units">{count(rest.reduce((sum, p) => sum + p.units, 0))}</td>
                  <td className="ranking-revenue">{money(restRevenue)}</td>
                  <td className="ranking-share">{share(restRevenue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <p className="ranking-footnote">Highest revenue first. Select a product for details.</p>
        </>
      )}
    </section>
  )
}
