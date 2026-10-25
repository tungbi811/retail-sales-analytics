import { useRef } from 'react'
import { useThumb } from '../lib/motion'

interface Props<T extends string | number> {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  small?: boolean
}

/** Pill tabs whose white thumb slides to the chosen option. */
export function Segmented<T extends string | number>({ label, options, value, onChange, small }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const thumb = useThumb(ref, '[aria-pressed="true"]', [value, options.length])

  return (
    <div className={`seg ${small ? 'seg-sm' : ''}`} role="group" aria-label={label} ref={ref}>
      <span className="seg-thumb" style={thumb} aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
