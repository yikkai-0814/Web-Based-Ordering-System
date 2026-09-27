import type { ComponentProps } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { useTranslation } from '@/features/i18n/useTranslation'
import { cn } from '@/lib/utils'

/**
 * The two arrows, which are the same button twice.
 *
 * A plain `<button>` rather than the `Button` component: the smallest that offers is `size-8`,
 * and two of those stacked would be half again as tall as the field they sit in. The colours,
 * the hover and the focus ring are the ones `Button`'s ghost variant uses, so they still look
 * like the rest of the application.
 */
const STEPPER_BUTTON =
  'flex flex-1 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50'

/**
 * One step of a sort order, from whatever is in the field at this moment.
 *
 * It reads the field rather than a number of its own, so typing and stepping stay the same
 * value — the input is still the single source of truth and nothing about how the figure is
 * validated or saved changes. There is no minimum or maximum to clamp against: every form
 * that has one has only ever required a whole number, and the security rules only
 * `sortOrder is int`, so one is not invented here.
 *
 * A blank field reads as 0, which is already what each form saves for one. Anything the
 * browser somehow let through that is not a number starts from 0 too, rather than turning
 * the field into NaN.
 */
function stepSortOrder(current: string, by: number): string {
  const value = Number(current)
  return String((Number.isFinite(value) ? Math.trunc(value) : 0) + by)
}

type SortOrderInputProps = Omit<
  ComponentProps<'input'>,
  'type' | 'step' | 'inputMode' | 'value' | 'onChange'
> & {
  value: string
  onValueChange: (next: string) => void
  /** Prefix for the arrows' test ids, for a page that shows more than one of these. */
  testId?: string
}

/**
 * A sort-order field: a plain number field with its own small arrows.
 *
 * `type="number"`, so the keyboard behaviour is the browser's own: Arrow Up and Arrow Down
 * step the value, and a phone offers a numeric keypad. The browser's built-in spinners are
 * switched off because they appear only in some engines, sit outside the field's padding and
 * are far too small for a counter — these replace them everywhere rather than doubling up in
 * Chrome and vanishing in Safari.
 *
 * The arrows are positioned inside the field's own box, so the control is exactly as wide and
 * as tall as the field would be without them; the caller's `className` sizes it to match the
 * form it sits in. The value stays a string, exactly as each form already held it, so every
 * form's own validation reads it unchanged.
 */
export function SortOrderInput({
  value,
  onValueChange,
  testId = 'sort-order',
  className,
  disabled,
  id,
  ...props
}: SortOrderInputProps) {
  const { t } = useTranslation()

  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        type="number"
        step={1}
        inputMode="numeric"
        className={cn(
          'pr-9 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          className,
        )}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
      />
      <div className="absolute inset-y-1 end-1 flex w-7 flex-col gap-px">
        {/* `type="button"`, or each of these would submit the form it sits in. Labelled rather
            than left to the icon: the glyph alone says "up", not "up what". */}
        <button
          type="button"
          data-testid={`${testId}-increase`}
          aria-label={t('menu.sortOrderIncrease')}
          aria-controls={id}
          className={STEPPER_BUTTON}
          disabled={disabled}
          onClick={() => onValueChange(stepSortOrder(value, 1))}
        >
          <ChevronUp aria-hidden="true" className="size-3.5" />
        </button>
        <button
          type="button"
          data-testid={`${testId}-decrease`}
          aria-label={t('menu.sortOrderDecrease')}
          aria-controls={id}
          className={STEPPER_BUTTON}
          disabled={disabled}
          onClick={() => onValueChange(stepSortOrder(value, -1))}
        >
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
