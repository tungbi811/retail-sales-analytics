import { useEffect, useRef, type ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'

interface Props {
  title: string
  sub: string
  icon: LucideIcon
  onClose: () => void
  children: ReactNode
  /** Which side of the page it opens on, next to the button that opened it. */
  side?: 'left' | 'right'
}

/** A sheet that opens beside the button that opened it. Escape or a click outside closes it; the rail stays usable. */
export function Panel({ title, sub, icon: Icon, onClose, children, side = 'left' }: Props) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const down = (e: MouseEvent) => {
      const t = e.target as Element
      if (!ref.current?.contains(t) && !t.closest('.rail, [data-panel-toggle]')) onClose()
    }
    document.addEventListener('keydown', key)
    document.addEventListener('mousedown', down)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('mousedown', down)
    }
  }, [onClose])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])

  return (
    <aside className={`panel panel-${side}`} ref={ref} role="dialog" aria-labelledby="panel-title">
      <header className="panel-head">
        <span className="panel-icon" aria-hidden="true">
          <Icon size={17} strokeWidth={1.8} />
        </span>
        <span>
          <h2 id="panel-title">{title}</h2>
          <p>{sub}</p>
        </span>
        <button className="panel-close" aria-label={`Close ${title}`} onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </header>
      <div className="panel-body">{children}</div>
    </aside>
  )
}
