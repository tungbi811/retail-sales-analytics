import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import type { ProductStat } from '../data/analytics'
import { money } from '../lib/format'
import { Info } from './Info'

interface Props {
  products: ProductStat[]
  category: string
  comparison: string
  onSelect: (id: string) => void
}

function Change({ value }: { value: number }) {
  return (
    <span className="driver-delta">
      {value > 0 && <ArrowUpRight size={14} className="pos" aria-hidden="true" />}
      {value < 0 && <ArrowDownRight size={14} className="neg" aria-hidden="true" />}
      <span>{value > 0 ? '+' : value < 0 ? '−' : ''}{money(Math.abs(value))}</span>
    </span>
  )
}

export function RevenueDrivers({ products, category, comparison, onSelect }: Props) {
  const previous = products.reduce((sum, p) => sum + p.previousRevenue, 0)
  const current = products.reduce((sum, p) => sum + p.revenue, 0)
  const hasComparison = products.some((p) => p.previousOrders > 0)
  const hasSales = products.some((p) => p.orders > 0 || p.previousOrders > 0)
  const changed = products
    .map((p) => ({ ...p, difference: p.revenue - p.previousRevenue }))
    .filter((p) => p.difference !== 0)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.product_name.localeCompare(b.product_name))
  const rest = changed.slice(5)
  const restPrevious = rest.reduce((sum, p) => sum + p.previousRevenue, 0)
  const restCurrent = rest.reduce((sum, p) => sum + p.revenue, 0)

  return (
    <section className="card revenue-drivers" aria-labelledby="drivers-title">
      <h2 className="card-title" id="drivers-title">
        What drove the sales change? <Info text="Each product's revenue this period minus its revenue in the comparison period, for the selected region and category. Ranked by the size of the difference, not percentage growth. These are contributions to the change, not evidence of its cause." />
      </h2>
      <p className="drivers-period">{category === 'All' ? 'All products' : category} · {comparison}</p>

      {!hasComparison ? (
        <div className="drivers-empty">
          <p>{hasSales ? 'No comparison sales' : 'No sales in either period.'}</p>
          {hasSales && <p>Revenue change is not shown without comparison sales. Current revenue: {money(current)}.</p>}
        </div>
      ) : (
        <>
          <p className="drivers-summary">
            <strong><Change value={current - previous} /></strong> net revenue change
            <span>{money(previous)} <ArrowRight size={12} aria-hidden="true" /> {money(current)}</span>
          </p>
          {changed.length === 0 ? (
            <p className="drivers-empty">No product-level revenue changes in these periods.</p>
          ) : (
            <>
              <table className="driver-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Previous → current</th>
                    <th scope="col">Revenue change</th>
                  </tr>
                </thead>
                <tbody>
                  {changed.slice(0, 5).map((p) => (
                    <tr key={p.product_id}>
                      <th scope="row">
                        <button className="driver-name" onClick={() => onSelect(p.product_id)}>{p.product_name}</button>
                        {!p.previousOrders && <span className="driver-note">No comparison sales</span>}
                        {!p.orders && <span className="driver-note">No sales this period</span>}
                      </th>
                      <td className="driver-revenue">{money(p.previousRevenue)} → {money(p.revenue)}</td>
                      <td className="driver-change"><Change value={p.difference} /></td>
                    </tr>
                  ))}
                </tbody>
                {rest.length > 0 && (
                  <tfoot>
                    <tr>
                      <th scope="row">Other products ({rest.length})</th>
                      <td className="driver-revenue">{money(restPrevious)} → {money(restCurrent)}</td>
                      <td className="driver-change"><Change value={restCurrent - restPrevious} /></td>
                    </tr>
                  </tfoot>
                )}
              </table>
              <p className="drivers-footnote">Largest absolute changes first. Select a product for details.</p>
            </>
          )}
        </>
      )}
    </section>
  )
}
