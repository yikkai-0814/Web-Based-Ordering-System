import { interpolate, type Message } from '@/features/i18n/messages'
import { en, type TranslationKey } from '@/features/i18n/translations/en'

/**
 * Renders a message or a key in English, for tests.
 *
 * The pure modules return keys now rather than sentences, which is the right shape — but a
 * test that asserted "the counter is told the cart is empty" is still a test worth having.
 * This lets those assertions stay readable while checking the same thing the interface will
 * show, rather than a key that could be wired to the wrong sentence.
 */
export function say(value: Message | TranslationKey): string {
  if (typeof value === 'string') return en[value]
  return interpolate(en[value.key], value.params)
}
