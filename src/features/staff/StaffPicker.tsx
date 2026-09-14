import type { TranslationKey } from '@/features/i18n/translations/en'
import { useTranslation } from '@/features/i18n/useTranslation'
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
  heading = 'staff.whoIsAtTill',
  blurb = 'staff.whoIsAtTillBlurb',
}: {
  onSelected?: () => void
  /**
   * Overridden by New Order, which asks per order rather than per shift.
   *
   * Keys rather than sentences: a caller cannot pass prose through here, so this screen
   * stays translated whoever renders it.
   */
  heading?: TranslationKey
  blurb?: TranslationKey
}) {
  const { t } = useTranslation()
  const { operators, select, loading } = useStaffSession()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 py-6 sm:py-8">
      <div className="space-y-1 text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-balance sm:text-2xl">
          {t(heading)}
        </h1>
        <p className="text-sm text-balance text-muted-foreground">{t(blurb)}</p>
      </div>

      {/* The roster arrives asynchronously. Without this, the picker briefly shows only the
          signed-in account and looks as though named staff are missing. */}
      {loading && <p className="text-center text-sm text-muted-foreground">{t('staff.loading')}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* Two across even on the narrowest phone: these are names, not paragraphs, and a
            single column would push the later ones off a short screen. */}
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
            className="flex min-h-touch-lg flex-col items-center justify-center gap-1 rounded-xl border bg-card px-3 py-4 text-center shadow-xs transition-[box-shadow,border-color,background-color,transform] duration-100 hover:border-primary/40 hover:bg-primary/[0.04] hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]"
          >
            <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
            <span className="line-clamp-2 text-base font-medium">{operator.name}</span>
            {operator.isSelf && (
              <span className="text-xs text-muted-foreground">{t('staff.thisAccount')}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
