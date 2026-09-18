// @vitest-environment jsdom
/**
 * Naming a modifier option in three languages, and reading it back in one.
 *
 * Two screens, one rule. The admin types a translation in a dialog behind the option row;
 * the till shows whichever name matches the language it is set to, or the English one when
 * there is no translation — never a gap. The language is set the way a device sets it,
 * through the stored preference the provider reads at mount, rather than by a second
 * language state invented for tests.
 */
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LANGUAGE_STORAGE_KEY } from '@/features/i18n/languages'

import { renderComponent } from './render'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ role: 'admin', profile: { uid: 'u1', role: 'admin' } }),
}))
vi.mock('@/features/menu/useModifierGroups', () => ({
  useModifierGroups: () => ({ groups: [], loading: false }),
}))
vi.mock('@/features/menu/useModifierOptionCosts', () => ({
  useModifierOptionCosts: () => ({ costs: new Map(), loading: false }),
}))
vi.mock('@/features/menu/menu-api', () => ({
  createModifierGroupForItem: vi.fn(),
  attachModifierGroup: vi.fn(),
  detachModifierGroup: vi.fn(),
  deleteModifierGroup: vi.fn(),
  setModifierGroupActive: vi.fn(),
  updateModifierGroup: vi.fn(),
  itemsUsingGroup: vi.fn().mockResolvedValue([]),
}))

import { GroupForm } from '@/features/menu/ModifierGroupsEditor'
import { ItemCustomisationDialog } from '@/features/pos/ItemCustomisationDialog'
import type { ModifierGroup } from '@/features/menu/modifiers'
import type { MenuItem } from '@/features/menu/types'

const GROUP_ID = 'g-addons'

/** An option the vendor has translated, and one they never touched. */
const group = (): ModifierGroup => ({
  id: GROUP_ID,
  itemId: null,
  name: 'Add-ons',
  selection: 'multiple',
  required: false,
  sortOrder: 0,
  active: true,
  options: [
    {
      id: 'add-egg',
      name: 'Fried Egg',
      names: { en: 'Fried Egg', ms: 'Telur Goreng', zh: '煎蛋' },
      priceAdjustment: 100,
      active: true,
    },
    {
      id: 'add-chicken',
      name: 'Extra Chicken',
      names: { en: 'Extra Chicken', ms: '', zh: '' },
      priceAdjustment: 300,
      active: true,
    },
  ],
  createdAt: null,
  updatedAt: null,
})

const NASI_GORENG: MenuItem = {
  id: 'i-nasi',
  name: 'Fried Rice',
  names: { en: 'Fried Rice', ms: 'Nasi Goreng', zh: '炒饭' },
  description: '',
  categoryId: 'c1',
  price: 800,
  sortOrder: 0,
  active: true,
  modifierGroupIds: [GROUP_ID],
  createdAt: null,
  updatedAt: null,
}

const onSave = vi.fn()

function speakingIn(language: string) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
}

const renderForm = () =>
  renderComponent(<GroupForm group={group()} onSave={onSave} onCancel={() => {}} />)

/** The rows in the option table, in the order the group lists them. */
const rows = () => screen.getAllByTestId('option-row')
const translateButtonIn = (row: HTMLElement) => within(row).getByTestId('option-translate')
const malayField = () => screen.getByTestId('option-name-ms') as HTMLInputElement
const chineseField = () => screen.getByTestId('option-name-zh') as HTMLInputElement
const saveDialog = () => screen.getByTestId('translate-option-save')

/** The options as the last group save described them. */
const savedOptions = () => {
  const input = onSave.mock.calls.at(-1)?.[0] as
    { options: { id: string; name: string; names: object }[] } | undefined
  if (!input) throw new Error('expected the group to have been saved')
  return input.options
}

beforeEach(() => {
  window.localStorage.clear()
  onSave.mockReset()
})

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('lang')
})

describe('the option row keeps its shape and gains one control', () => {
  it('still heads the table with the same four columns', () => {
    renderForm()

    expect(screen.getByTestId('option-columns').textContent).toBe('NameAdds (RM)Cost (RM)Actions')
  })

  it('offers translating from the Actions area, one control per option', () => {
    renderForm()

    expect(screen.getAllByTestId('option-translate')).toHaveLength(2)
    // In the Actions cell, beside the status and delete controls — not a column of its own.
    const actions = translateButtonIn(rows()[0]!).parentElement
    expect(within(actions!).getByTestId('option-toggle-active')).not.toBeNull()
  })

  it('shows how many translations an option has, and says so in its label', () => {
    renderForm()

    const translated = translateButtonIn(rows()[0]!)
    expect(translated.getAttribute('data-translations')).toBe('2')
    expect(translated.textContent).toContain('2')
    expect(translated.getAttribute('aria-label')).toBe('Translate Fried Egg, 2 translations')

    const untranslated = translateButtonIn(rows()[1]!)
    expect(untranslated.getAttribute('data-translations')).toBe('0')
    expect(untranslated.textContent).not.toContain('0')
    expect(untranslated.getAttribute('aria-label')).toBe('Translate Extra Chicken')
  })

  it('leaves the Name input editing the canonical English name', () => {
    renderForm()

    // English is edited where it has always been edited. The dialog does not offer a second
    // place to change it, which would be two controls over one field.
    expect((within(rows()[0]!).getByLabelText('Name') as HTMLInputElement).value).toBe('Fried Egg')
  })
})

describe('the translation dialog', () => {
  it('names what is being translated and explains the fallback', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[0]!))

    expect(screen.getByTestId('translate-option-title').textContent).toBe('Translate Fried Egg')
    expect(screen.getByText(/Translations are optional/)).not.toBeNull()
  })

  it('shows the English name without letting it be edited here', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[0]!))

    const english = screen.getByTestId('option-name-en') as HTMLInputElement
    expect(english.value).toBe('Fried Egg')
    expect(english.readOnly).toBe(true)
  })

  it('loads the translations the option already has', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[0]!))

    expect(malayField().value).toBe('Telur Goreng')
    expect(chineseField().value).toBe('煎蛋')
  })

  it('opens empty for an option nobody has translated', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[1]!))

    expect(malayField().value).toBe('')
    expect(chineseField().value).toBe('')
  })

  it('labels each field with the language named in itself', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[0]!))

    expect(screen.getByLabelText('Bahasa Melayu')).not.toBeNull()
    expect(screen.getByLabelText('中文')).not.toBeNull()
  })

  it('discards what was typed when it is cancelled', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[1]!))
    await user.type(malayField(), 'Ayam Tambahan')
    await user.click(screen.getByTestId('translate-option-cancel'))
    await user.click(screen.getByTestId('modifier-save-group'))

    expect(savedOptions()[1]?.names).toEqual({})
  })
})

describe('what a group save records about an option’s names', () => {
  it('adds Malay and Chinese to an option that had neither', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[1]!))
    await user.type(malayField(), 'Ayam Tambahan')
    await user.type(chineseField(), '加鸡肉')
    await user.click(saveDialog())
    await user.click(screen.getByTestId('modifier-save-group'))

    expect(savedOptions()[1]?.names).toEqual({ ms: 'Ayam Tambahan', zh: '加鸡肉' })
  })

  it('never puts English inside the translations', async () => {
    const { user } = renderForm()
    await user.click(screen.getByTestId('modifier-save-group'))

    const egg = savedOptions()[0]
    expect(egg?.name).toBe('Fried Egg')
    expect(Object.keys(egg?.names ?? {})).toEqual(['ms', 'zh'])
  })

  it('writes an empty map for an option nobody translated, as an old document reads', async () => {
    const { user } = renderForm()
    await user.click(screen.getByTestId('modifier-save-group'))

    expect(savedOptions()[1]?.names).toEqual({})
  })

  it('does not erase Chinese when only Malay is edited', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[0]!))
    await user.clear(malayField())
    await user.type(malayField(), 'Telur Mata')
    await user.click(saveDialog())
    await user.click(screen.getByTestId('modifier-save-group'))

    expect(savedOptions()[0]?.names).toEqual({ ms: 'Telur Mata', zh: '煎蛋' })
  })

  it('does not erase Malay when only Chinese is edited', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[0]!))
    await user.clear(chineseField())
    await user.type(chineseField(), '荷包蛋')
    await user.click(saveDialog())
    await user.click(screen.getByTestId('modifier-save-group'))

    expect(savedOptions()[0]?.names).toEqual({ ms: 'Telur Goreng', zh: '荷包蛋' })
  })

  it('clears a translation the admin deliberately emptied', async () => {
    // The map is written whole, so removing a name removes it from the document too.
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[0]!))
    await user.clear(malayField())
    await user.click(saveDialog())
    await user.click(screen.getByTestId('modifier-save-group'))

    expect(savedOptions()[0]?.names).toEqual({ zh: '煎蛋' })
  })

  it('treats a translation of nothing but spaces as no translation', async () => {
    const { user } = renderForm()
    await user.click(translateButtonIn(rows()[1]!))
    await user.type(malayField(), '   ')
    await user.click(saveDialog())
    await user.click(screen.getByTestId('modifier-save-group'))

    expect(savedOptions()[1]?.names).toEqual({})
  })

  it('keeps the English name as the canonical, searchable one for an untranslated option', async () => {
    const { user } = renderForm()
    await user.click(screen.getByTestId('modifier-save-group'))

    // Nothing about translating changes what an option is called in the record an admin
    // reads and searches: English is always there, whether or not anybody translated it.
    expect(savedOptions().map((option) => option.name)).toEqual(['Fried Egg', 'Extra Chicken'])
  })
})

describe('the till shows the option in the language it is set to', () => {
  const renderTill = (onAdd = vi.fn()) =>
    renderComponent(
      <ItemCustomisationDialog
        item={NASI_GORENG}
        groups={[group()]}
        onAdd={onAdd}
        onCancel={() => {}}
      />,
    )

  const optionLabels = () =>
    screen.getAllByTestId('modifier-option').map((button) => button.textContent)

  it('shows English names on an English till', () => {
    renderTill()

    expect(optionLabels()[0]).toContain('Fried Egg')
    expect(optionLabels()[1]).toContain('Extra Chicken')
  })

  it('shows the Malay name, and the English one where there is no Malay', () => {
    speakingIn('ms')
    renderTill()

    expect(screen.getByTestId('customise-title').textContent).toBe('Nasi Goreng')
    expect(optionLabels()[0]).toContain('Telur Goreng')
    // Untranslated: the English name rather than a blank button.
    expect(optionLabels()[1]).toContain('Extra Chicken')
  })

  it('shows the Chinese name on a Chinese till', () => {
    speakingIn('zh')
    renderTill()

    expect(screen.getByTestId('customise-title').textContent).toBe('炒饭')
    expect(optionLabels()[0]).toContain('煎蛋')
  })
})

describe('an order snapshots the option name the counter was showing', () => {
  const chooseEgg = async (language: string) => {
    speakingIn(language)
    const onAdd = vi.fn()
    const { user } = renderComponent(
      <ItemCustomisationDialog
        item={NASI_GORENG}
        groups={[group()]}
        onAdd={onAdd}
        onCancel={() => {}}
      />,
    )
    await user.click(screen.getAllByTestId('modifier-option')[0]!)
    await user.click(screen.getByTestId('customise-add'))
    return onAdd.mock.calls.at(-1)?.[0] as { optionId: string; optionName: string }[]
  }

  it('records the Malay name when the till was speaking Malay', async () => {
    const chosen = await chooseEgg('ms')

    expect(chosen[0]?.optionName).toBe('Telur Goreng')
    // The id is what costing and reporting identify the option by, and it never varies.
    expect(chosen[0]?.optionId).toBe('add-egg')
  })

  it('records the Chinese name when the till was speaking Chinese', async () => {
    expect((await chooseEgg('zh'))[0]?.optionName).toBe('煎蛋')
  })

  it('records the English name when the till was speaking English', async () => {
    expect((await chooseEgg('en'))[0]?.optionName).toBe('Fried Egg')
  })
})
