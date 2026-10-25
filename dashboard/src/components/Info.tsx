import { useId } from 'react'
import { Info as InfoIcon } from 'lucide-react'

/** Small "i" button that explains where a number comes from. Shows on hover and keyboard focus. */
export function Info({ text }: { text: string }) {
  const id = useId()
  return (
    <span className="info">
      <button className="info-btn" aria-describedby={id} aria-label="About this metric">
        <InfoIcon size={13} strokeWidth={1.8} />
      </button>
      <span role="tooltip" id={id} className="info-tip">
        {text}
      </span>
    </span>
  )
}
