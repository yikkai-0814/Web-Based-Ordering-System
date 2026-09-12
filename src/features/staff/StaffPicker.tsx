import { UserRound } from 'lucide-react'

import { useStaffSession } from '@/features/staff/useStaffSession'

/**
 * The screen that stands in front of the till until somebody says who they are.
 *
 * Deliberately not a login: there is no secret to enter, and it grants nothing. It records
 * who is at the counter so every order can name them.
 *
 * The signed-in account is always offered, so this screen can never become a dead end — a
 * staff-role user cannot create staff identities, and being unable to sell because nobody
 * has set the roster up would be far worse than an unnamed operator.
 */
export function StaffPicker({
  onSelected,
  heading = 'Who is on the till?',
  blurb = 'Your name is recorded on every order you take. Tap yours to start.',
}: {
  onSelected?: () => void
  /** Overridden by New Order, which asks per order rather than per shift. */
  heading?: string
  blurb?: string
}) {
  const { operators, select, loading } = useStaffSession()

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-muted-foreground">{blurb}</p>
      </div>

      {/* The roster arrives asynchronously. Without this, the picker briefly shows only the
          signed-in account and looks as though named staff are missing. */}
      {loading && <p className="text-center text-sm text-muted-foreground">Loading staff…</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {operators.map((operator) => (
          <button
            key={operator.id}
            type="button"
            data-testid="staff-option"
            data-staff-name={operator.name}
            data-self={operator.isSelf}
            onClick={() => {
              select(operator.id)
              onSelected?.()
            }}
            // min-h, not a fixed height: the name is the point of this screen, so the tile grows
            // to fit rather than clipping it.
            className="flex min-h-touch-lg flex-col items-center justify-center gap-1 rounded-lg border bg-card px-3 py-4 text-center transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
            <span className="line-clamp-2 text-base font-medium">{operator.name}</span>
            {operator.isSelf && <span className="text-xs text-muted-foreground">This account</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
