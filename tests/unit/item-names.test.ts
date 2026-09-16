import { say } from '../say'
import { describe, expect, it } from 'vitest'

import {
  emptyItemNames,
  getLocalizedMenuItemName,
  ITEM_NAME_MAX,
  parseItemNames,
  storedTranslations,
  TRANSLATABLE_LANGUAGES,
  validateItemNames,
  type LocalizedName,
} from '@/features/menu/item-names'
import { parseMenuItem } from '@/features/menu/types'

/**
 * A menu item's name in three languages.
 *
 * Two properties carry this feature. That an item written before it existed — a bare `name`
 * and nothing else — still reads exactly as it always did, because there is a great deal of
 * such data and none of it is going to be migrated. And that a missing translation falls back
 * to English in ONE place, so no screen can invent its own answer.
 */

/** A document as it is stored, translations and all. */
const FRIED_RICE = {
  name: 'Fried Rice',
  names: { ms: 'Nasi Goreng', zh: '炒饭' },
  description: '',
  categoryId: 'mains',
  price: 800,
  sortOrder: 0,
  active: true,
  createdAt: null,
  updatedAt: null,
}

/** The same item as every document written before this feature: one name, no map. */
const LEGACY = { ...FRIED_RICE, names: undefined }

describe('a menu item written before translations existed', () => {
  it('still parses, and still has its name', () => {
    const item = parseMenuItem('item-1', LEGACY)
    expect(item).not.toBeNull()
    expect(item?.name).toBe('Fried Rice')
  })

  it('answers every language with the English name', () => {
    const item = parseMenuItem('item-1', LEGACY)
    expect(item?.names).toEqual({ en: 'Fried Rice', ms: '', zh: '' })
    expect(getLocalizedMenuItemName(item!, 'ms')).toBe('Fried Rice')
    expect(getLocalizedMenuItemName(item!, 'zh')).toBe('Fried Rice')
  })

  it('is nameable even if it reaches a screen without being parsed at all', () => {
    // Raw data that skipped parseMenuItem must not take a till down mid-service.
    expect(getLocalizedMenuItemName({ name: 'Fried Rice' }, 'zh')).toBe('Fried Rice')
  })
})

describe('a menu item with all three names', () => {
  it('parses English from `name` and the rest from the map', () => {
    const item = parseMenuItem('item-1', FRIED_RICE)
    expect(item?.names).toEqual({ en: 'Fried Rice', ms: 'Nasi Goreng', zh: '炒饭' })
  })

  it('keeps English in `name` and never in the map', () => {
    // The whole point of the shape: one English name, in the field everything already reads.
    expect(Object.keys(FRIED_RICE.names)).toEqual(['ms', 'zh'])
  })
})

describe('getLocalizedMenuItemName', () => {
  const item = parseMenuItem('item-1', FRIED_RICE)!

  it('returns the English name on an English screen', () => {
    expect(getLocalizedMenuItemName(item, 'en')).toBe('Fried Rice')
  })

  it('returns the Malay name on a Malay screen', () => {
    expect(getLocalizedMenuItemName(item, 'ms')).toBe('Nasi Goreng')
  })

  it('returns the Chinese name on a Chinese screen', () => {
    expect(getLocalizedMenuItemName(item, 'zh')).toBe('炒饭')
  })

  it('falls back to English when Malay is missing', () => {
    const noMalay = parseMenuItem('item-1', { ...FRIED_RICE, names: { zh: '炒饭' } })!
    expect(getLocalizedMenuItemName(noMalay, 'ms')).toBe('Fried Rice')
    expect(getLocalizedMenuItemName(noMalay, 'zh')).toBe('炒饭')
  })

  it('falls back to English when Chinese is missing', () => {
    const noChinese = parseMenuItem('item-1', { ...FRIED_RICE, names: { ms: 'Nasi Goreng' } })!
    expect(getLocalizedMenuItemName(noChinese, 'zh')).toBe('Fried Rice')
    expect(getLocalizedMenuItemName(noChinese, 'ms')).toBe('Nasi Goreng')
  })

  it('treats a translation of nothing but spaces as no translation', () => {
    const blank = parseMenuItem('item-1', { ...FRIED_RICE, names: { ms: '   ', zh: '' } })!
    expect(getLocalizedMenuItemName(blank, 'ms')).toBe('Fried Rice')
    expect(getLocalizedMenuItemName(blank, 'zh')).toBe('Fried Rice')
  })

  it('ignores a map that is not a map, or holds values that are not names', () => {
    for (const names of [null, 'Nasi Goreng', 42, { ms: 7 }, { fr: 'Riz frit' }]) {
      const item = parseMenuItem('item-1', { ...FRIED_RICE, names })!
      expect(getLocalizedMenuItemName(item, 'ms')).toBe('Fried Rice')
    }
  })
})

describe('what gets stored', () => {
  it('keeps only the translations, trimmed', () => {
    const names: LocalizedName = { en: 'Fried Rice', ms: '  Nasi Goreng  ', zh: '炒饭' }
    expect(storedTranslations(names)).toEqual({ ms: 'Nasi Goreng', zh: '炒饭' })
  })

  it('leaves out a language with nothing in it', () => {
    expect(storedTranslations({ en: 'Fried Rice', ms: '', zh: '炒饭' })).toEqual({ zh: '炒饭' })
  })

  it('leaves out a language holding only whitespace', () => {
    // Stored, it would render as a gap on a Malay till instead of falling back.
    expect(storedTranslations({ en: 'Fried Rice', ms: '   ', zh: '' })).toEqual({})
  })

  it('writes an empty map for an item with no translations at all', () => {
    expect(storedTranslations(emptyItemNames())).toEqual({})
  })

  it('never stores English', () => {
    const stored = storedTranslations({ en: 'Fried Rice', ms: 'Nasi Goreng', zh: '炒饭' })
    expect('en' in stored).toBe(false)
    expect(TRANSLATABLE_LANGUAGES).toEqual(['ms', 'zh'])
  })

  it('survives a round trip through the document and back', () => {
    const names: LocalizedName = { en: 'Fried Rice', ms: 'Nasi Goreng', zh: '炒饭' }
    expect(parseItemNames(names.en, storedTranslations(names))).toEqual(names)
  })
})

describe('validateItemNames', () => {
  it('accepts all three and returns them trimmed', () => {
    const result = validateItemNames({ en: '  Fried Rice ', ms: ' Nasi Goreng', zh: ' 炒饭 ' })
    expect(result).toEqual({ ok: true, names: { en: 'Fried Rice', ms: 'Nasi Goreng', zh: '炒饭' } })
  })

  it('requires English', () => {
    for (const en of ['', '   ']) {
      const result = validateItemNames({ en, ms: 'Nasi Goreng', zh: '炒饭' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.key).toBe('validation.itemNameRequired')
    }
  })

  it('accepts an item with no Malay name', () => {
    expect(validateItemNames({ en: 'Fried Rice', ms: '', zh: '炒饭' }).ok).toBe(true)
  })

  it('accepts an item with no Chinese name', () => {
    expect(validateItemNames({ en: 'Fried Rice', ms: 'Nasi Goreng', zh: '' }).ok).toBe(true)
  })

  it('accepts an item with neither, which is every existing item', () => {
    expect(validateItemNames({ en: 'Fried Rice', ms: '', zh: '' }).ok).toBe(true)
  })

  it('holds a translation to the same maximum length as the English name', () => {
    // Not a new rule invented for this feature: ITEM_NAME_MAX is what `name` has always been
    // held to, here and in firestore.rules.
    const tooLong = 'x'.repeat(ITEM_NAME_MAX + 1)
    for (const draft of [
      { en: tooLong, ms: '', zh: '' },
      { en: 'Fried Rice', ms: tooLong, zh: '' },
      { en: 'Fried Rice', ms: '', zh: tooLong },
    ]) {
      const result = validateItemNames(draft)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(say(result.error)).toMatch(/at most 80 characters/i)
    }
  })

  it('measures after trimming, so padding is not a rejection', () => {
    const exactly = 'x'.repeat(ITEM_NAME_MAX)
    expect(validateItemNames({ en: exactly, ms: `  ${exactly}  `, zh: '' }).ok).toBe(true)
  })
})
