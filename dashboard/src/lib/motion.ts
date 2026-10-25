import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const easeOut = (p: number) => 1 - (1 - p) ** 3

/**
 * Tweens a list of numbers from what is on screen to the new targets.
 * Starts from 0 on first render, so values count up when the page loads.
 */
export function useTweenList(target: number[], duration = 650) {
  const [shown, setShown] = useState(() => (reduced() ? target : target.map(() => 0)))
  const shownRef = useRef(shown)
  const key = target.join('|')

  useEffect(() => {
    if (reduced()) {
      shownRef.current = target
      setShown(target)
      return
    }
    const from = shownRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const e = easeOut(Math.min(1, (now - start) / duration))
      const next = target.map((t, i) => (from[i] ?? 0) + (t - (from[i] ?? 0)) * e)
      shownRef.current = next
      setShown(next)
      if (e < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // target is read through key, so a new array holding the same numbers does not restart the tween
  }, [key, duration])

  return shown
}

export function useTween(target: number, duration?: number) {
  return useTweenList([target], duration)[0]
}

/**
 * Position of a sliding "thumb" under the active child of a pill group.
 * The active child is the one matching the selector (aria-pressed or aria-current).
 */
export function useThumb(ref: RefObject<HTMLElement | null>, selector: string, deps: unknown[]) {
  const [box, setBox] = useState<{ x: number; w: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const active = el.querySelector<HTMLElement>(selector)
      setBox(active ? { x: active.offsetLeft, w: active.offsetWidth } : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, deps)

  return box ? { transform: `translateX(${box.x}px)`, width: box.w } : { opacity: 0 }
}

/** Width of an element, kept current with a ResizeObserver. For charts drawn in pixels. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 600) {
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}
