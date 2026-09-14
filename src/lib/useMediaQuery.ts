import { useEffect, useState } from 'react'

/**
 * Whether a CSS media query currently matches, as a value React can branch on.
 *
 * **Why this exists rather than a `hidden md:block` pair.** The Orders list is a nine-column
 * table on a laptop and a stack of cards on a phone. Rendering both and hiding one with CSS
 * is the cheap way to write that, and it is what this page did — which meant a 250-order day
 * built 500 row subtrees to show 250, and paid for every one of them in reconciliation,
 * layout and memory. Measured on a seeded day: 7,000 DOM elements and 3.8 seconds of blocked
 * main thread, roughly half of it for rows nobody could see.
 *
 * Branching in React instead means only the layout in use is ever mounted. The Tailwind
 * classes are deliberately left in place as well: if this hook is ever wrong, CSS still
 * hides the wrong one, so the failure is a duplicate rather than two visible lists.
 *
 * `matchMedia` is absent in jsdom, so the initial read is guarded and defaults to "matches".
 * Every caller passes a min-width query, so the default is the wide layout — the one a test
 * environment with no viewport should reasonably assume.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    // Read once on subscribe: the query may have changed, or the viewport may have moved
    // between the first render and this effect.
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}

/** `md` in Tailwind. Declared once so the hook and the class it mirrors cannot drift. */
export const MD_BREAKPOINT = '(min-width: 48rem)'
