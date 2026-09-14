import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LANGUAGE,
  isLanguage,
  LANGUAGES,
  LANGUAGE_LABELS,
  LANGUAGE_STORAGE_KEY,
  LANGUAGE_TAGS,
  parseLanguage,
} from '@/features/i18n/languages'
import { interpolate, isMessageError, message, MessageError } from '@/features/i18n/messages'
import { en, type Dictionary, type TranslationKey } from '@/features/i18n/translations/en'
import { ms } from '@/features/i18n/translations/ms'
import { zh } from '@/features/i18n/translations/zh'

/**
 * The translation layer.
 *
 * Two properties matter more than any individual string. That every language answers every
 * key — otherwise a screen goes blank in one language and nobody notices until a customer is
 * waiting. And that vendor-entered text passes through untranslated, which is the one thing
 * this feature must never get wrong.
 */

const DICTIONARIES = { en, ms, zh }

describe('every language answers every key', () => {
  const keys = Object.keys(en) as TranslationKey[]

  it.each(Object.keys(DICTIONARIES))('%s has exactly the keys English has', (code) => {
    const dictionary = DICTIONARIES[code as keyof typeof DICTIONARIES]
    expect(Object.keys(dictionary).sort()).toEqual(keys.slice().sort())
  })

  it.each(Object.keys(DICTIONARIES))('%s leaves nothing blank', (code) => {
    const dictionary = DICTIONARIES[code as keyof typeof DICTIONARIES]
    const blank = keys.filter((key) => dictionary[key].trim() === '')
    expect(blank).toEqual([])
  })

  it.each(Object.keys(DICTIONARIES))('%s keeps every placeholder English uses', (code) => {
    // A dropped {{name}} silently loses the customer's order number from a sentence.
    const dictionary = DICTIONARIES[code as keyof typeof DICTIONARIES]
    const placeholders = (value: string) => (value.match(/\{\{\w+\}\}/g) ?? []).sort()

    for (const key of keys) {
      expect(placeholders(dictionary[key]), key).toEqual(placeholders(en[key]))
    }
  })

  it('is actually translated, not copied — the two others differ from English', () => {
    // A handful legitimately match: '0.00', '12.50', a person's name in a placeholder.
    const sameAsEnglish = (dictionary: Dictionary) =>
      (Object.keys(en) as TranslationKey[]).filter((key) => dictionary[key] === en[key])

    expect(sameAsEnglish(ms).length).toBeLessThan(keys.length * 0.1)
    expect(sameAsEnglish(zh).length).toBeLessThan(keys.length * 0.1)
  })
})

describe('choosing a language', () => {
  it('offers the three the vendor asked for', () => {
    expect(LANGUAGES).toEqual(['en', 'ms', 'zh'])
  })

  it('defaults to English, which is the language everything is authored in', () => {
    expect(DEFAULT_LANGUAGE).toBe('en')
    expect(parseLanguage(null)).toBe('en')
    expect(parseLanguage(undefined)).toBe('en')
  })

  it('falls back to English for anything it does not recognise', () => {
    // A value from an older build, a half-written string, a key set by hand.
    for (const bad of ['', 'EN', 'fr', 'zh-TW', 'null', '{}']) {
      expect(parseLanguage(bad)).toBe('en')
    }
  })

  it('keeps a stored choice', () => {
    for (const code of LANGUAGES) expect(parseLanguage(code)).toBe(code)
  })

  it('names each language in itself, never in the current one', () => {
    // Somebody looking for Chinese is looking for 中文.
    expect(LANGUAGE_LABELS.en).toBe('English')
    expect(LANGUAGE_LABELS.ms).toBe('Bahasa Melayu')
    expect(LANGUAGE_LABELS.zh).toBe('中文')
  })

  it('has a document tag for each, so assistive technology agrees with the screen', () => {
    for (const code of LANGUAGES) expect(LANGUAGE_TAGS[code]).toBeTruthy()
    expect(LANGUAGE_TAGS.zh).toBe('zh-Hans')
  })

  it('stores the preference per device, like the theme', () => {
    expect(LANGUAGE_STORAGE_KEY).toBe('ordering-system.language')
  })

  it('recognises exactly the three codes', () => {
    expect(isLanguage('ms')).toBe(true)
    expect(isLanguage('de')).toBe(false)
    expect(isLanguage(7)).toBe(false)
  })
})

describe('interpolation puts vendor text in untouched', () => {
  it('splices a value in without altering it', () => {
    expect(interpolate('Choose {{group}}.', { group: 'Vegetables' })).toBe('Choose Vegetables.')
  })

  it('does not case-fold, trim or otherwise tidy what the vendor typed', () => {
    const typed = '  MILO  Ais  '
    expect(interpolate('{{name}}', { name: typed })).toBe(typed)
  })

  it('leaves non-Latin vendor text alone', () => {
    expect(interpolate('{{name}}', { name: '海南鸡饭' })).toBe('海南鸡饭')
  })

  it('fills every occurrence of a placeholder', () => {
    expect(interpolate('{{a}} and {{a}}', { a: 'x' })).toBe('x and x')
  })

  it('leaves an unmatched placeholder visible rather than blanking it', () => {
    // A visible {{name}} is a bug report; an empty gap is a mystery.
    expect(interpolate('Hello {{name}}', {})).toBe('Hello {{name}}')
  })

  it('accepts numbers as well as strings', () => {
    expect(interpolate('#{{n}}', { n: 12 })).toBe('#12')
  })

  it('returns the template untouched when there is nothing to fill', () => {
    expect(interpolate('Plain sentence.')).toBe('Plain sentence.')
  })
})

describe('messages carry a key, never a sentence', () => {
  it('builds one with and without parameters', () => {
    expect(message('cart.empty')).toEqual({ key: 'cart.empty' })
    expect(message('validation.chooseGroup', { group: 'Egg' })).toEqual({
      key: 'validation.chooseGroup',
      params: { group: 'Egg' },
    })
  })

  it('travels through an error the UI can translate', () => {
    const thrown = new MessageError(message('validation.cartEmpty'))
    expect(isMessageError(thrown)).toBe(true)
    expect(thrown.detail.key).toBe('validation.cartEmpty')
    // The key doubles as the Error text, so an uncaught one still says something.
    expect(thrown.message).toBe('validation.cartEmpty')
  })

  it('does not mistake an ordinary error for one of ours', () => {
    expect(isMessageError(new Error('boom'))).toBe(false)
    expect(isMessageError('boom')).toBe(false)
    expect(isMessageError(null)).toBe(false)
  })
})

describe('the vendor’s own words are never keys', () => {
  it('has no dictionary entry that looks like menu or staff data', () => {
    // A guard against somebody "helpfully" adding 'Chicken Chop Rice' to the dictionary.
    const suspicious = (Object.keys(en) as TranslationKey[]).filter(
      (key) => key.startsWith('menuItem.') || key.startsWith('staffMember.'),
    )
    expect(suspicious).toEqual([])
  })

  it('keeps every sentence that names vendor data parameterised', () => {
    // If these ever stop taking a parameter, a vendor's word has been baked into a
    // translation — which is exactly what this feature must not do.
    for (const key of [
      'validation.chooseGroup',
      'validation.chooseOnlyOne',
      'validation.optionWithdrawn',
      'validation.linePrice',
      'cart.addOne',
      'orders.receiptFor',
    ] as TranslationKey[]) {
      expect(en[key]).toMatch(/\{\{\w+\}\}/)
    }
  })
})
