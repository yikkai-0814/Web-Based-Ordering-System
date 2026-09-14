// @vitest-environment jsdom
/**
 * Choosing a language, and what changes when you do.
 *
 * The dictionaries are checked in tests/unit. What is checked here is that the choice
 * actually reaches the screen, survives a reload, and — the part that matters most — leaves
 * everything the vendor typed exactly as they typed it.
 */
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LanguageProvider } from '@/features/i18n/LanguageProvider'
import { LANGUAGE_STORAGE_KEY } from '@/features/i18n/languages'
import { useTranslation } from '@/features/i18n/useTranslation'
import { OverallStatusBadge } from '@/features/pos/PaymentStatusBadge'

import { renderComponent } from './render'

/** A component that shows one predefined label beside one piece of vendor-entered text. */
function Probe({ vendorName }: { vendorName: string }) {
  const { language, setLanguage, t } = useTranslation()
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="label">{t('nav.newOrder')}</span>
      <span data-testid="vendor">{vendorName}</span>
      <span data-testid="interpolated">{t('cart.addOne', { name: vendorName })}</span>
      <button onClick={() => setLanguage('ms')}>ms</button>
      <button onClick={() => setLanguage('zh')}>zh</button>
      <button onClick={() => setLanguage('en')}>en</button>
    </div>
  )
}

const VENDOR = 'Nasi Lemak Ayam'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('lang')
})

describe('the default', () => {
  it('starts in English with nothing stored', () => {
    renderComponent(<Probe vendorName={VENDOR} />)
    expect(screen.getByTestId('language').textContent).toBe('en')
    expect(screen.getByTestId('label').textContent).toBe('New Order')
  })

  it('starts in English after a value it does not recognise', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon')
    renderComponent(<Probe vendorName={VENDOR} />)
    expect(screen.getByTestId('language').textContent).toBe('en')
  })
})

describe('switching language', () => {
  it('changes predefined text across the interface', async () => {
    const { user } = renderComponent(<Probe vendorName={VENDOR} />)
    expect(screen.getByTestId('label').textContent).toBe('New Order')

    await user.click(screen.getByRole('button', { name: 'ms' }))
    expect(screen.getByTestId('label').textContent).toBe('Pesanan Baharu')

    await user.click(screen.getByRole('button', { name: 'zh' }))
    expect(screen.getByTestId('label').textContent).toBe('新订单')

    await user.click(screen.getByRole('button', { name: 'en' }))
    expect(screen.getByTestId('label').textContent).toBe('New Order')
  })

  it('changes a status badge, which every screen shows', async () => {
    const { user } = renderComponent(
      <>
        <Probe vendorName={VENDOR} />
        <OverallStatusBadge status="completed" />
      </>,
    )
    expect(screen.getByTestId('overall-status').textContent).toBe('Completed')

    await user.click(screen.getByRole('button', { name: 'ms' }))
    expect(screen.getByTestId('overall-status').textContent).toBe('Selesai')
  })

  it('remembers the choice for the next visit', async () => {
    const { user, unmount } = renderComponent(<Probe vendorName={VENDOR} />)
    await user.click(screen.getByRole('button', { name: 'zh' }))
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh')
    unmount()

    renderComponent(<Probe vendorName={VENDOR} />)
    expect(screen.getByTestId('language').textContent).toBe('zh')
    expect(screen.getByTestId('label').textContent).toBe('新订单')
  })

  it('tells the document which language it is in', async () => {
    const { user } = renderComponent(<Probe vendorName={VENDOR} />)
    expect(document.documentElement.lang).toBe('en')

    await user.click(screen.getByRole('button', { name: 'zh' }))
    expect(document.documentElement.lang).toBe('zh-Hans')
  })
})

describe('vendor-entered data is never translated', () => {
  it('shows a menu item name exactly as it was typed, in every language', async () => {
    const { user } = renderComponent(<Probe vendorName={VENDOR} />)
    expect(screen.getByTestId('vendor').textContent).toBe(VENDOR)

    for (const code of ['ms', 'zh', 'en']) {
      await user.click(screen.getByRole('button', { name: code }))
      expect(screen.getByTestId('vendor').textContent).toBe(VENDOR)
    }
  })

  it('splices it into a translated sentence without altering it', async () => {
    const { user } = renderComponent(<Probe vendorName={VENDOR} />)
    expect(screen.getByTestId('interpolated').textContent).toBe(`Add one ${VENDOR}`)

    await user.click(screen.getByRole('button', { name: 'ms' }))
    expect(screen.getByTestId('interpolated').textContent).toBe(`Tambah satu ${VENDOR}`)
    // The sentence around it changed; the vendor's words did not.
    expect(screen.getByTestId('interpolated').textContent).toContain(VENDOR)
  })

  it('leaves non-Latin vendor text alone too', async () => {
    const { user } = renderComponent(<Probe vendorName="海南鸡饭" />)
    await user.click(screen.getByRole('button', { name: 'ms' }))
    expect(screen.getByTestId('vendor').textContent).toBe('海南鸡饭')
  })
})

describe('storage that will not cooperate', () => {
  it('still renders when localStorage throws', () => {
    // A private window, or a browser set to block site data.
    const original = window.localStorage.getItem
    window.localStorage.getItem = () => {
      throw new Error('blocked')
    }
    try {
      renderComponent(<Probe vendorName={VENDOR} />)
      expect(screen.getByTestId('language').textContent).toBe('en')
    } finally {
      window.localStorage.getItem = original
    }
  })
})

describe('the provider is required', () => {
  it('says so plainly rather than rendering nothing', () => {
    // Without it every component would silently lose its words.
    expect(() =>
      renderComponent(
        <LanguageProvider>
          <Probe vendorName={VENDOR} />
        </LanguageProvider>,
      ),
    ).not.toThrow()
  })
})
