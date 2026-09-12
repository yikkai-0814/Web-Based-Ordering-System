import { describe, expect, it } from 'vitest'

import { parseCollapsed, serializeCollapsed } from '@/components/layout/sidebar-state'
import { parseThemePreference, resolveTheme, THEMES } from '@/features/theme/theme'

describe('parseThemePreference', () => {
  it('accepts each of the three choices', () => {
    for (const preference of THEMES) {
      expect(parseThemePreference(preference)).toBe(preference)
    }
  })

  it('falls back to following the system for anything else', () => {
    // Following the system is the one answer that is never wrong for long, so junk, an empty
    // string, a value from an older build and nothing at all all land there.
    for (const raw of [null, undefined, '', 'sepia', 'DARK', '{"theme":"dark"}']) {
      expect(parseThemePreference(raw)).toBe('system')
    }
  })
})

describe('resolveTheme', () => {
  it('honours an explicit choice whatever the system says', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the system when asked to', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('only ever resolves to a palette that exists', () => {
    for (const preference of THEMES) {
      for (const systemDark of [true, false]) {
        expect(['light', 'dark']).toContain(resolveTheme(preference, systemDark))
      }
    }
  })
})

describe('sidebar collapse preference', () => {
  it('is collapsed only when the stored value says so', () => {
    expect(parseCollapsed('true')).toBe(true)
    expect(parseCollapsed('false')).toBe(false)
  })

  it('shows the labels for anything unrecognisable', () => {
    // A first visit or a cleared browser should not present a column of unexplained icons.
    for (const raw of [null, undefined, '', '1', 'yes', 'TRUE']) {
      expect(parseCollapsed(raw)).toBe(false)
    }
  })

  it('round-trips what it wrote', () => {
    expect(parseCollapsed(serializeCollapsed(true))).toBe(true)
    expect(parseCollapsed(serializeCollapsed(false))).toBe(false)
  })
})
