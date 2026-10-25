import { useTween } from '../lib/motion'

/** A number that counts to its new value. Screen readers get the final value only. */
export function Num({ value, format }: { value: number; format: (n: number) => string }) {
  const shown = useTween(value)
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  )
}
