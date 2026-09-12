// @vitest-environment jsdom
/**
 * The three presentation pieces the Dashboard and Reports share.
 *
 * Nothing here asserts a class name — that would pin the styling rather than the behaviour.
 * What is worth holding still is what a person (or a screen reader) actually gets: the
 * figure, the label, a link where a figure leads somewhere, and a bar that states its value
 * in words as well as in width.
 */
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { EmptyState } from '@/components/data/EmptyState'
import { MeterBar } from '@/components/data/MeterBar'
import { Panel } from '@/components/data/Panel'
import { StatCard } from '@/components/data/StatCard'

import { renderComponent } from './render'

describe('StatCard', () => {
  it('shows the label, the figure and the hint as given', () => {
    renderComponent(<StatCard label="Revenue" value="RM 318.90" hint="Paid or not" />)
    expect(screen.getByText('Revenue')).not.toBeNull()
    expect(screen.getByText('RM 318.90')).not.toBeNull()
    expect(screen.getByText('Paid or not')).not.toBeNull()
  })

  it('formats nothing itself — the caller owns the string', () => {
    // Guards against somebody later "helpfully" adding currency or rounding in here, which
    // would put a second money formatter in the codebase.
    renderComponent(<StatCard label="Orders" value="7" />)
    expect(screen.getByText('7')).not.toBeNull()
  })

  it('becomes a link when a figure leads somewhere', () => {
    renderComponent(
      <MemoryRouter>
        <StatCard label="Unpaid" value="3" to="/orders" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link').getAttribute('href')).toBe('/orders')
  })

  it('is not a link when it leads nowhere', () => {
    renderComponent(<StatCard label="Voided" value="1" />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('MeterBar', () => {
  it('states its value in text, not only as a width', () => {
    // Length and colour are the second channel. Anyone who cannot judge either still reads
    // the figure.
    renderComponent(<MeterBar label="Cash · 4 orders" value="RM 120.00" percent={64} />)
    expect(screen.getByText('Cash · 4 orders')).not.toBeNull()
    expect(screen.getByText('RM 120.00')).not.toBeNull()
  })

  it('exposes the share to assistive technology', () => {
    renderComponent(<MeterBar label="Cost coverage" value="RM 10 of RM 12" percent={82.4} />)
    const meter = screen.getByRole('meter', { name: 'Cost coverage' })
    expect(meter.getAttribute('aria-valuenow')).toBe('82')
    expect(meter.getAttribute('aria-valuetext')).toBe('82%')
  })

  it('says so rather than guessing when there is no share to show', () => {
    renderComponent(<MeterBar label="Cost coverage" value="—" percent={null} />)
    const meter = screen.getByRole('meter', { name: 'Cost coverage' })
    expect(meter.getAttribute('aria-valuenow')).toBeNull()
    expect(meter.getAttribute('aria-valuetext')).toBe('Not available')
  })

  it('clamps a share that would otherwise overflow its track', () => {
    renderComponent(<MeterBar label="Over" value="lots" percent={140} />)
    expect(screen.getByRole('meter', { name: 'Over' }).getAttribute('aria-valuenow')).toBe('100')

    renderComponent(<MeterBar label="Under" value="none" percent={-20} />)
    expect(screen.getByRole('meter', { name: 'Under' }).getAttribute('aria-valuenow')).toBe('0')
  })
})

describe('EmptyState', () => {
  it('says what is empty and what to do about it', () => {
    // An empty list that says nothing looks exactly like one that failed to load.
    renderComponent(
      <EmptyState title="No sales recorded on this date" description="Use the date bar." />,
    )
    expect(screen.getByText('No sales recorded on this date')).not.toBeNull()
    expect(screen.getByText('Use the date bar.')).not.toBeNull()
  })

  it('works with a title alone', () => {
    renderComponent(<EmptyState title="Nothing was voided" />)
    expect(screen.getByText('Nothing was voided')).not.toBeNull()
  })
})

describe('MeterBar: ranking', () => {
  it('shows the position it was given as a numeral', () => {
    // The ranking is legible without comparing bar lengths — and this component is never
    // the thing that decides the order.
    renderComponent(
      <MeterBar label="Flat White" value="RM 250.00" percent={100} rank={1} leading />,
    )
    expect(screen.getByText('1')).not.toBeNull()
    expect(screen.getByText('Flat White')).not.toBeNull()
  })

  it('works without a rank at all', () => {
    renderComponent(<MeterBar label="Cash" value="RM 10.00" percent={50} />)
    expect(screen.queryByText('1')).toBeNull()
  })
})

describe('Panel', () => {
  it('renders its heading and children at any weight', () => {
    renderComponent(
      <Panel tone="accent" title="Cost and profitability" description="What it cost to earn it">
        <p>body</p>
      </Panel>,
    )
    expect(screen.getByRole('heading', { name: 'Cost and profitability' })).not.toBeNull()
    expect(screen.getByText('What it cost to earn it')).not.toBeNull()
    expect(screen.getByText('body')).not.toBeNull()
  })

  it('can carry content with no heading at all', () => {
    renderComponent(
      <Panel tone="plain">
        <p>just content</p>
      </Panel>,
    )
    expect(screen.getByText('just content')).not.toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('nests its heading one level down when asked', () => {
    // Keeps the document outline honest when a panel sits inside another section.
    renderComponent(
      <Panel title="How today was paid" as="h3">
        <p>bars</p>
      </Panel>,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'How today was paid' })).not.toBeNull()
  })
})

describe('StatCard: weight', () => {
  it('renders the same figure at every weight', () => {
    // The variant changes how loudly it is drawn, never what it says.
    for (const variant of ['hero', 'default', 'quiet'] as const) {
      const { unmount } = renderComponent(
        <StatCard label="Revenue" value="RM 318.90" variant={variant} />,
      )
      expect(screen.getByText('RM 318.90')).not.toBeNull()
      unmount()
    }
  })
})
