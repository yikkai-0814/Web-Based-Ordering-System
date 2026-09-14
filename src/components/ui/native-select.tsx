import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A native `<select>`, themed.
 *
 * Native rather than a custom listbox, deliberately: on a touch screen the operating
 * system's own picker beats anything rebuilt in a div, and it is reachable by keyboard and
 * screen reader for free.
 *
 * **Why the colours are stated rather than inherited.** Setting any `background-color` on a
 * `<select>` — `transparent` included — opts the element out of the browser's native
 * appearance for its drop-down list. The list is then painted with the author's background,
 * and `transparent` resolves to the white canvas, while the option text keeps inheriting the
 * page's `color`. In the dark theme that is near-white text on a white list: every option
 * unreadable until the cursor lands on it and the system highlight takes over. The option
 * that shows in the closed control looked fine throughout, because that one is drawn against
 * the card, which is why the fault read as "only the first option works".
 *
 * So the control and its options each name a theme token. `--popover` is the right surface
 * for the list — it is what every other floating layer in this application sits on — and both
 * tokens are defined for light and dark, so the two themes follow the same rule rather than
 * one of them relying on a default.
 *
 * `color-scheme` is still set on the document by ThemeProvider and still matters; it is what
 * themes the scrollbar and the drop-down arrow. It cannot rescue the option colours on its
 * own once a background has been set here, which is why this exists.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'h-touch w-full rounded-lg border border-input bg-background px-2.5 text-base text-foreground outline-none',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        'disabled:opacity-50',
        // The drop-down list. Hover and selected states are left to the browser, which draws
        // them with the system highlight against these colours and so stays distinguishable
        // in both themes.
        '[&>option]:bg-popover [&>option]:text-popover-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { NativeSelect }
