import { useMemo } from 'react'
import { MapPin, ShoppingBag, Star } from 'lucide-react'
import type { Warehouse } from '../data/types'
import { pct, salesFor, type RegionFilter } from '../data/metrics'
import { categoryByGender, customerStats, periodRange, segments, spendTiers, type CustomerStats, type Period } from '../data/analytics'
import { count, dayMonth, money, moneyShort } from '../lib/format'
import { useTween, useTweenList } from '../lib/motion'
import { toneOf } from '../lib/tones'
import { Num } from '../components/Num'
import { Info } from '../components/Info'
import { Footnote, PageHead } from '../components/PageHead'

interface Props {
  wh: Warehouse
  region: RegionFilter
  onRegion: (r: RegionFilter) => void
  period: Period
  onPeriod: (p: Period) => void
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

export function CustomersPage({ wh, region, onRegion, period, onPeriod }: Props) {
  const rows = useMemo(() => salesFor(wh, region), [wh, region])
  const range = useMemo(() => periodRange(wh, period), [wh, period])
  const stats = useMemo(() => customerStats(wh, period, region), [wh, period, region])
  const seg = useMemo(() => segments(stats), [stats])
  const mix = useMemo(() => categoryByGender(wh, rows, range), [wh, rows, range])
  const before = useMemo(() => customerStats(wh, period, region, 'previous'), [wh, period, region])
  const tiers = useMemo(() => spendTiers(stats), [stats])
  const catOrder = useMemo(() => [...new Set(wh.products.map((p) => p.category))].sort((a, b) => a.localeCompare(b)), [wh])
  const top = stats.list[0]

  return (
    <main className="main page-customers">
      <PageHead title="Customers" wh={wh} region={region} onRegion={onRegion} period={period} onPeriod={onPeriod} span={range.label} />

      <div className="row cust-top">
        {top && (
          <section className="card cust-spot" aria-labelledby="spot-title">
            <p className="eyebrow">
              <Star size={13} strokeWidth={2} aria-hidden="true" /> Top customer <Info text="Highest revenue in the period and region." />
            </p>
            <div className="cust-spot-who">
              <span className="cust-avatar" aria-hidden="true">
                {initials(top.customer_name)}
              </span>
              <div>
                <h2 id="spot-title">{top.customer_name}</h2>
                <p>
                  {top.gender} · {top.age_group} · born {top.birth_year}
                </p>
              </div>
            </div>
            <p className="cust-spot-value">
              <Num value={top.revenue} format={money} />
            </p>
            <ul className="cust-facts">
              <li>
                <ShoppingBag size={14} strokeWidth={1.8} aria-hidden="true" />
                {top.orders} orders · {count(top.units)} units
              </li>
              <li>
                <Star size={14} strokeWidth={1.8} aria-hidden="true" />
                Mostly {top.favourite}
              </li>
              <li>
                <MapPin size={14} strokeWidth={1.8} aria-hidden="true" />
                {top.homeStore}
              </li>
            </ul>
            <p className="cust-spot-foot">Last order {dayMonth(top.last)}</p>
          </section>
        )}

        <section className="card" aria-labelledby="ring-title">
          <h2 className="card-title" id="ring-title">
            Who buys <Info text="Share of period revenue by dim_customer.gender. Centre: customers with at least one order in the period." />
          </h2>
          <GenderRing stats={stats} genders={seg.genders} />
          <div className="stack-rows">
            {mix.rows.map((r) => (
              <div className="stack-row" key={r.gender}>
                <p className="stack-label">
                  <b>{r.gender} buys</b> <span>{moneyShort(r.total)}</span>
                </p>
                <div className="stack stack-thin" role="img" aria-label={`${r.gender}: ${mix.categories.map((c, i) => `${c} ${Math.round(r.shares[i] * 100)}%`).join(', ')}`}>
                  {mix.categories.map((c, i) => (
                    <span key={c} className={`stack-part ${toneOf(catOrder, c)}`} style={{ width: `${r.shares[i] * 100}%` }} title={`${c} ${Math.round(r.shares[i] * 100)}%`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <ul className="stack-legend">
            {mix.categories.map((c) => (
              <li key={c}>
                <i className={`key ${toneOf(catOrder, c)}`} aria-hidden="true" />
                {c}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="age-title">
          <h2 className="card-title" id="age-title">
            Spend per head by age <Info text="Revenue per active customer in each age_group, one capsule per gender. Age groups use reference_year from dbt_project.yml." />
          </h2>
          <AgeCapsules seg={seg} />
        </section>
      </div>

      <div className="row cust-mid">
        <section className="card" aria-labelledby="health-title">
          <h2 className="card-title" id="health-title">
            Customer health <Info text="Active: customers with at least one order in the period. Returning: active customers who had ordered before the period started. Changes compare with the period before." />
          </h2>
          <p className="health-vs">{before.active ? `Change ${range.vs}` : `No orders ${range.vs.replace(/^vs /, 'in ')} to compare with`}</p>
          <Health now={stats} before={before} />
        </section>

        <section className="card" aria-labelledby="tiers-title">
          <h2 className="card-title" id="tiers-title">
            Who brings the revenue <Info text="Active customers ranked by what they spent in the period, then split into the top 10%, the next 40% and the bottom half." />
          </h2>
          <Tiers data={tiers} />
        </section>
      </div>

      <section className="card" aria-labelledby="people-title">
        <h2 className="card-title" id="people-title">
          People <Info text="Active customers by revenue. Favourite: the category they spent most on. Home store: where they ordered most." />
        </h2>
        <ul className="people">
          {stats.list.slice(0, 12).map((c, i) => (
            <li key={c.customer_id} className="person">
              <span className="person-rank">{i + 1}</span>
              <span className={`avatar person-avatar ${toneOf(seg.genders, c.gender)}`} aria-hidden="true">
                {initials(c.customer_name)}
              </span>
              <span className="person-main">
                <b>{c.customer_name}</b>
                <span>
                  {c.gender} · {c.age_group} · {c.homeStore.replace('Beautorial ', '')}
                </span>
              </span>
              <span className={`chip ${toneOf(catOrder, c.favourite)}-soft`}>{c.favourite}</span>
              <span className="person-spend">
                <b>{money(c.revenue)}</b>
                <span>{c.orders} orders</span>
              </span>
              <span className="person-bar" aria-hidden="true">
                <span style={{ width: `${(c.revenue / (stats.list[0]?.revenue || 1)) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Footnote wh={wh}>Customers from gold.dim_customer, joined to gold.fact_sales on customer_id.</Footnote>
    </main>
  )
}

function GenderRing({ stats, genders }: { stats: CustomerStats; genders: string[] }) {
  const by = genders.map((g) => stats.list.filter((c) => c.gender === g).reduce((a, c) => a + c.revenue, 0))
  const total = by.reduce((a, b) => a + b, 0) || 1
  const shares = useTweenList(
    by.map((v) => v / total),
    900,
  )
  const active = useTween(stats.active, 900)
  const r = 54
  const c = 2 * Math.PI * r
  let at = 0
  return (
    <div className="gender">
      <div className="gender-ring">
        <svg viewBox="0 0 140 140" role="img" aria-label={genders.map((g, i) => `${g} ${Math.round((by[i] / total) * 100)}%`).join(', ')}>
          <circle cx="70" cy="70" r={r} className="ring-track-soft" />
          {genders.map((g, i) => {
            const len = (shares[i] ?? 0) * c
            const el = (
              <circle
                key={g}
                cx="70"
                cy="70"
                r={r}
                className={`gender-arc ${toneOf(genders, g)}-stroke`}
                strokeDasharray={`${Math.max(0, len - 3)} ${c}`}
                strokeDashoffset={-at}
                transform="rotate(-90 70 70)"
              />
            )
            at += len
            return el
          })}
        </svg>
        <div className="gender-center">
          <b>{Math.round(active)}</b>
          <span>of {stats.total} active</span>
        </div>
      </div>
      <ul className="gender-keys">
        {genders.map((g, i) => (
          <li key={g}>
            <i className={`key ${toneOf(genders, g)}`} aria-hidden="true" />
            <b>{g}</b>
            <span>
              {Math.round((by[i] / total) * 100)}% · {stats.list.filter((c) => c.gender === g).length} people
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AgeCapsules({ seg }: { seg: ReturnType<typeof segments> }) {
  const flat = seg.ages.flatMap((_, ai) => seg.genders.map((_, gi) => seg.cells[gi][ai].perCustomer))
  const shown = useTweenList(flat, 900)
  // Scaled to what is on screen too, so bars still shrinking from a bigger period never rise above their track.
  const max = Math.max(1, ...flat, ...shown)
  const bestIndex = flat.indexOf(Math.max(...flat))
  return (
    <>
      <div className="capsules" role="list">
        {seg.ages.map((age, ai) => (
          <div className="capsule-group" key={age} role="listitem">
            <div className="capsule-pair">
              {seg.genders.map((g, gi) => {
                const i = ai * seg.genders.length + gi
                const cell = seg.cells[gi][ai]
                return (
                  <span
                    key={g}
                    className={`capsule ${i === bestIndex ? 'is-best' : ''}`}
                    title={`${g}, ${age}: ${money(cell.perCustomer)} per customer, ${cell.customers} customers`}
                  >
                    <span className={`capsule-fill ${toneOf(seg.genders, g)}`} style={{ height: `${((shown[i] ?? 0) / max) * 100}%` }} />
                    {i === bestIndex && <span className="capsule-tag">{moneyShort(cell.perCustomer)}</span>}
                  </span>
                )
              })}
            </div>
            <span className="capsule-label">{age}</span>
          </div>
        ))}
      </div>
      <ul className="gender-keys gender-keys-row">
        {seg.genders.map((g) => (
          <li key={g}>
            <i className={`key ${toneOf(seg.genders, g)}`} aria-hidden="true" />
            {g}
          </li>
        ))}
      </ul>
    </>
  )
}

/** Four numbers about the customer base, each against the period before. */
function Health({ now, before }: { now: CustomerStats; before: CustomerStats }) {
  const per = (s: CustomerStats, v: number) => (s.active ? v / s.active : 0)
  const back = (s: CustomerStats) => per(s, s.returning) * 100
  const has = before.active > 0
  const growth = (a: number, b: number) => (has ? pct(a, b) : null)
  const tiles = [
    { label: 'Active customers', value: count(now.active), note: `of ${count(now.total)} on file`, change: growth(now.active, before.active), unit: '%' },
    { label: 'Returning', value: `${Math.round(back(now))}%`, note: `${count(now.returning)} had ordered before`, change: has ? back(now) - back(before) : null, unit: ' pts' },
    { label: 'Spend per customer', value: money(per(now, now.revenue)), note: 'revenue ÷ active customers', change: growth(per(now, now.revenue), per(before, before.revenue)), unit: '%' },
    { label: 'Orders per customer', value: per(now, now.orders).toFixed(1), note: 'how often they come back', change: growth(per(now, now.orders), per(before, before.orders)), unit: '%' },
  ]
  return (
    <dl className="health">
      {tiles.map((t) => (
        <div key={t.label}>
          <dt>{t.label}</dt>
          <dd>
            <b>{t.value}</b>
            {t.change !== null && <Change value={t.change} unit={t.unit} />}
          </dd>
          <dd className="health-note">{t.note}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A rounded change as a green or red chip; rounding to zero reads as no change. */
function Change({ value, unit }: { value: number; unit: string }) {
  const n = Math.round(value)
  if (n === 0) return <span className="delta delta-flat">No change</span>
  return <span className={`delta ${n > 0 ? 'delta-up' : 'delta-down'}`}>{`${n > 0 ? '+' : '−'}${Math.abs(n)}${unit}`}</span>
}

const TIER_TONES = ['s1', 's2', 's5']

/** A 100% bar of revenue by spend group, then one line per group. */
function Tiers({ data }: { data: ReturnType<typeof spendTiers> }) {
  const [top] = data.tiers
  if (!top.customers) return <p className="empty">No customers in this period.</p>
  const shown = data.tiers.filter((t) => t.customers > 0)
  return (
    <>
      <p className="tiers-lede">
        The top {count(top.customers)} {top.customers === 1 ? 'customer brings' : 'customers bring'} <b>{Math.round(top.share * 100)}%</b> of revenue.
      </p>
      <div className="tiers-bar" role="img" aria-label={shown.map((t) => `${t.label} ${Math.round(t.share * 100)}%`).join(', ')}>
        {shown.map((t, i) => (
          <span key={t.key} className={TIER_TONES[i]} style={{ flexGrow: t.share || 0.001 }}>
            {t.share >= 0.08 && `${Math.round(t.share * 100)}%`}
          </span>
        ))}
      </div>
      <table className="tiers-table">
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Customers</th>
            <th scope="col">Avg spend</th>
            <th scope="col">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t, i) => (
            <tr key={t.key}>
              <th scope="row">
                <i className={`key ${TIER_TONES[i]}`} aria-hidden="true" />
                {t.label}
              </th>
              <td>{count(t.customers)}</td>
              <td>{money(t.avg)}</td>
              <td>
                <b>{Math.round(t.share * 100)}%</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiers-foot">
        Median spend <b>{money(data.median)}</b>
        <span aria-hidden="true">·</span>
        <b>{Math.round(data.oneTime * 100)}%</b> ordered only once
      </p>
    </>
  )
}
