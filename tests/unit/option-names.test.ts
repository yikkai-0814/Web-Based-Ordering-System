import { describe, expect, it } from 'vitest'

import { LANGUAGES } from '@/features/i18n/languages'
import { parseModifierGroup, selectionOf, type ModifierGroup } from '@/features/menu/modifiers'
import {
  getLocalizedModifierOptionName,
  MODIFIER_OPTION_NAME_MAX,
  optionTranslationsOf,
  parseOptionNames,
  translationCount,
  validateOptionNames,
} from '@/features/menu/option-names'

/**
 * What a modifier option is called, in each language the interface speaks.
 *
 * The rule is small and the cost of getting it wrong is a blank gap on a till, so it is
 * tested exhaustively here rather than only through the screens that read it: an option the
 * vendor never translated must keep working untouched, and a translation of nothing but
 * spaces must be indistinguishable from no translation at all.
 */

const FRIED_EGG = { name: 'Fried Egg', names: { ms: 'Telur Goreng', zh: '煎蛋' } }

describe('an option that was never translated', () => {
  it('shows its English name in every language, with no migration', () => {
    // Exactly the document shape this collection has always had: a name and nothing else.
    const option = parseOptionNames('Fried Egg', undefined)

    for (const language of LANGUAGES) {
      expect(getLocalizedModifierOptionName({ name: 'Fried Egg', names: option }, language)).toBe(
        'Fried Egg',
      )
    }
  })

  it('names itself even when it reached a screen without a parsed map at all', () => {
    // Raw data that skipped the parse, or a fixture older than this feature.
    expect(getLocalizedModifierOptionName({ name: 'Fried Egg' }, 'zh')).toBe('Fried Egg')
  })
})

describe('getLocalizedModifierOptionName', () => {
  const option = { name: 'Fried Egg', names: parseOptionNames('Fried Egg', FRIED_EGG.names) }

  it('answers English from the canonical name', () => {
    expect(getLocalizedModifierOptionName(option, 'en')).toBe('Fried Egg')
  })

  it('answers Malay and Chinese from the translations', () => {
    expect(getLocalizedModifierOptionName(option, 'ms')).toBe('Telur Goreng')
    expect(getLocalizedModifierOptionName(option, 'zh')).toBe('煎蛋')
  })

  it('falls back to English for a missing Malay name, and keeps Chinese', () => {
    const noMalay = { name: 'Fried Egg', names: parseOptionNames('Fried Egg', { zh: '煎蛋' }) }
    expect(getLocalizedModifierOptionName(noMalay, 'ms')).toBe('Fried Egg')
    expect(getLocalizedModifierOptionName(noMalay, 'zh')).toBe('煎蛋')
  })

  it('falls back to English for a missing Chinese name, and keeps Malay', () => {
    const noChinese = {
      name: 'Fried Egg',
      names: parseOptionNames('Fried Egg', { ms: 'Telur Goreng' }),
    }
    expect(getLocalizedModifierOptionName(noChinese, 'zh')).toBe('Fried Egg')
    expect(getLocalizedModifierOptionName(noChinese, 'ms')).toBe('Telur Goreng')
  })

  it('treats a translation of nothing but whitespace as missing, never rendering a gap', () => {
    const blank = { name: 'Fried Egg', names: parseOptionNames('Fried Egg', { ms: '   ', zh: '' }) }
    expect(getLocalizedModifierOptionName(blank, 'ms')).toBe('Fried Egg')
    expect(getLocalizedModifierOptionName(blank, 'zh')).toBe('Fried Egg')
  })
})

/**
 * Options live inside their group's document, in a list, and Firestore rules cannot iterate a
 * list to refuse what is in one. The parse is therefore the boundary that actually holds, and
 * it is asked here about every shape a hand-written or hostile document could carry.
 */
describe('what the parse refuses to read out of a names map', () => {
  it('ignores an unknown language key entirely', () => {
    const names = parseOptionNames('Fried Egg', { ms: 'Telur Goreng', fr: 'Œuf au plat' })

    expect(Object.keys(names).sort()).toEqual(['en', 'ms', 'zh'])
    expect(names).not.toHaveProperty('fr')
    expect(getLocalizedModifierOptionName({ name: 'Fried Egg', names }, 'ms')).toBe('Telur Goreng')
  })

  it('never lets a stored `en` override the canonical name', () => {
    // `en` has no business being in the map. If one was written by hand it is discarded:
    // English is `name`, and two records of one fact would be free to disagree.
    const names = parseOptionNames('Fried Egg', { en: 'Something Else', ms: 'Telur Goreng' })

    expect(names.en).toBe('Fried Egg')
    expect(getLocalizedModifierOptionName({ name: 'Fried Egg', names }, 'en')).toBe('Fried Egg')
  })

  it('discards a translation that is not a string', () => {
    const names = parseOptionNames('Fried Egg', { ms: 42, zh: null })

    expect(names.ms).toBe('')
    expect(getLocalizedModifierOptionName({ name: 'Fried Egg', names }, 'ms')).toBe('Fried Egg')
  })

  it('tolerates a names field that is not a map at all', () => {
    for (const raw of ['Telur Goreng', 7, [], null, undefined]) {
      expect(parseOptionNames('Fried Egg', raw).en).toBe('Fried Egg')
      expect(parseOptionNames('Fried Egg', raw).ms).toBe('')
    }
  })
})

describe('validateOptionNames decides what is worth writing', () => {
  it('trims everything and keeps only the translations that say something', () => {
    const result = validateOptionNames('  Fried Egg ', { ms: ' Telur Goreng', zh: '  ' })

    expect(result.ok && result.name).toBe('Fried Egg')
    expect(result.ok && result.names).toEqual({ ms: 'Telur Goreng' })
  })

  it('never puts English inside the translations', () => {
    const result = validateOptionNames('Fried Egg', { ms: 'Telur Goreng', zh: '煎蛋' })

    expect(result.ok && Object.keys(result.names).sort()).toEqual(['ms', 'zh'])
    expect(result.ok && result.names).not.toHaveProperty('en')
  })

  it('writes an empty map for an option nobody has translated', () => {
    const result = validateOptionNames('Fried Egg', {})

    expect(result.ok && result.names).toEqual({})
  })

  it('requires an English name, whatever else was typed', () => {
    const result = validateOptionNames('   ', { ms: 'Telur Goreng' })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.key).toBe('modifierAdmin.needOptionName')
  })

  it('holds a translation to the same length limit as the English name', () => {
    const tooLong = 'x'.repeat(MODIFIER_OPTION_NAME_MAX + 1)
    const result = validateOptionNames('Fried Egg', { ms: tooLong })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.key).toBe('validation.optionNameTooLong')
  })

  it('accepts a translation of exactly the limit, trimmed', () => {
    const exactly = 'x'.repeat(MODIFIER_OPTION_NAME_MAX)
    expect(validateOptionNames('Fried Egg', { ms: `  ${exactly}  ` }).ok).toBe(true)
  })

  it('round-trips: what it stores is what the parse reads back', () => {
    const stored = validateOptionNames('Fried Egg', { ms: 'Telur Goreng', zh: '煎蛋' })
    if (!stored.ok) throw new Error('expected valid names')

    const names = parseOptionNames(stored.name, stored.names)
    expect(getLocalizedModifierOptionName({ name: stored.name, names }, 'ms')).toBe('Telur Goreng')
    expect(getLocalizedModifierOptionName({ name: stored.name, names }, 'zh')).toBe('煎蛋')
  })
})

describe('the count behind the editor’s translation badge', () => {
  it('counts only translations that say something', () => {
    expect(translationCount({})).toBe(0)
    expect(translationCount({ ms: '   ' })).toBe(0)
    expect(translationCount({ ms: 'Telur Goreng' })).toBe(1)
    expect(translationCount({ ms: 'Telur Goreng', zh: '煎蛋' })).toBe(2)
  })

  it('reads an option back as the translations alone, for seeding the dialog', () => {
    const option = { name: 'Fried Egg', names: parseOptionNames('Fried Egg', FRIED_EGG.names) }
    expect(optionTranslationsOf(option)).toEqual({ ms: 'Telur Goreng', zh: '煎蛋' })

    const untranslated = { name: 'Fried Egg', names: parseOptionNames('Fried Egg', undefined) }
    expect(optionTranslationsOf(untranslated)).toEqual({})
  })
})

/**
 * A group as it is read back from Firestore, which is where an option's translations actually
 * come from. The point of these is that an option carries its names through the parse without
 * anything else about the group changing.
 */
describe('parseModifierGroup carries an option’s translations', () => {
  const raw = (options: unknown[]) => ({
    name: 'Add-ons',
    selection: 'multiple',
    required: false,
    sortOrder: 0,
    active: true,
    options,
    createdAt: null,
    updatedAt: null,
  })

  it('reads a translated option', () => {
    const group = parseModifierGroup(
      'g1',
      raw([
        {
          id: 'add-egg',
          name: 'Fried Egg',
          names: { ms: 'Telur Goreng', zh: '煎蛋' },
          priceAdjustment: 100,
          active: true,
        },
      ]),
    )

    expect(getLocalizedModifierOptionName(group!.options[0]!, 'ms')).toBe('Telur Goreng')
    expect(getLocalizedModifierOptionName(group!.options[0]!, 'zh')).toBe('煎蛋')
  })

  it('reads an option written before translations existed, unchanged', () => {
    const group = parseModifierGroup(
      'g1',
      raw([{ id: 'add-egg', name: 'Fried Egg', priceAdjustment: 100, active: true }]),
    )

    expect(group).not.toBeNull()
    expect(group!.options[0]!.name).toBe('Fried Egg')
    expect(getLocalizedModifierOptionName(group!.options[0]!, 'ms')).toBe('Fried Egg')
  })

  it('does not reject a group over a malformed names map — it drops the translation', () => {
    // A bad `names` is not a bad option: the option is still perfectly nameable in English,
    // and refusing the group would take a whole customisation prompt off the till.
    const group = parseModifierGroup(
      'g1',
      raw([
        { id: 'add-egg', name: 'Fried Egg', names: 'not a map', priceAdjustment: 0, active: true },
      ]),
    )

    expect(group).not.toBeNull()
    expect(getLocalizedModifierOptionName(group!.options[0]!, 'ms')).toBe('Fried Egg')
  })
})

/**
 * The historical guarantee, at the level of the snapshot itself.
 *
 * `selectionOf` is the moment an option's name stops being configuration and becomes the
 * record of what a customer was told. The screens are tested separately; this pins the rule.
 */
describe('a chosen option is snapshotted in the language the till was speaking', () => {
  const group = (): ModifierGroup =>
    parseModifierGroup('g-addons', {
      name: 'Add-ons',
      selection: 'multiple',
      required: false,
      sortOrder: 0,
      active: true,
      options: [
        {
          id: 'add-egg',
          name: 'Fried Egg',
          names: { ms: 'Telur Goreng', zh: '煎蛋' },
          priceAdjustment: 100,
          active: true,
        },
      ],
      createdAt: null,
      updatedAt: null,
    })!

  it('records the Malay name when the till is speaking Malay', () => {
    const chosen = selectionOf(group(), group().options[0]!, 'ms')

    expect(chosen.optionName).toBe('Telur Goreng')
    // The id is what reporting and costing identify the option by, and it is language-blind.
    expect(chosen.optionId).toBe('add-egg')
    expect(chosen.priceAdjustment).toBe(100)
  })

  it('records the English name when the option has no translation for that till', () => {
    const untranslated = parseModifierGroup('g-addons', {
      name: 'Add-ons',
      selection: 'multiple',
      required: false,
      sortOrder: 0,
      active: true,
      options: [{ id: 'add-egg', name: 'Fried Egg', priceAdjustment: 100, active: true }],
      createdAt: null,
      updatedAt: null,
    })!

    expect(selectionOf(untranslated, untranslated.options[0]!, 'ms').optionName).toBe('Fried Egg')
  })

  it('is untouched when the admin retranslates the option afterwards', () => {
    const sold = selectionOf(group(), group().options[0]!, 'ms')

    // The admin edits the option: a different Malay name entirely.
    const after = parseModifierGroup('g-addons', {
      name: 'Add-ons',
      selection: 'multiple',
      required: false,
      sortOrder: 0,
      active: true,
      options: [
        {
          id: 'add-egg',
          name: 'Fried Egg',
          names: { ms: 'Telur Mata', zh: '煎蛋' },
          priceAdjustment: 100,
          active: true,
        },
      ],
      createdAt: null,
      updatedAt: null,
    })!

    // What was sold says what it said. Only the next customer sees the new wording.
    expect(sold.optionName).toBe('Telur Goreng')
    expect(getLocalizedModifierOptionName(after.options[0]!, 'ms')).toBe('Telur Mata')
  })
})
