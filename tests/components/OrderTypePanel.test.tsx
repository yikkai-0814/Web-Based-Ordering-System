// @vitest-environment jsdom
/**
 * How the order is served, and the table it belongs to.
 *
 * The rule this panel exists to express is one the security rules also enforce: a dine-in
 * order carries a table number, and a takeaway must not carry the key at all. So the test
 * that matters most here is that switching to takeaway REMOVES the field rather than
 * disabling it — a greyed-out box would still suggest a takeaway might want a table.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { OrderTypePanel } from '@/features/pos/OrderTypePanel'
import type { OrderType } from '@/features/pos/order-type'

import { renderComponent } from './render'

function setup({ orderType = 'dine_in' as OrderType, tableNumber = '', disabled = false } = {}) {
  const onOrderTypeChange = vi.fn()
  const onTableNumberChange = vi.fn()
  const rendered = renderComponent(
    <OrderTypePanel
      orderType={orderType}
      tableNumber={tableNumber}
      disabled={disabled}
      onOrderTypeChange={onOrderTypeChange}
      onTableNumberChange={onTableNumberChange}
    />,
  )
  return { ...rendered, onOrderTypeChange, onTableNumberChange }
}

describe('OrderTypePanel: choosing how it is served', () => {
  it('marks the current type as pressed, and only that one', () => {
    setup({ orderType: 'dine_in' })
    expect(screen.getByTestId('order-type-dine_in').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('order-type-takeaway').getAttribute('aria-pressed')).toBe('false')
  })

  it('reports a change rather than deciding one', async () => {
    // Presentational by design: the till owns the selection, so the panel only reports.
    const { user, onOrderTypeChange } = setup({ orderType: 'dine_in' })
    await user.click(screen.getByTestId('order-type-takeaway'))
    expect(onOrderTypeChange).toHaveBeenCalledWith('takeaway')
  })

  it('changes nothing while disabled', async () => {
    const { user, onOrderTypeChange } = setup({ disabled: true })
    await user.click(screen.getByTestId('order-type-takeaway'))
    expect(onOrderTypeChange).not.toHaveBeenCalled()
  })
})

describe('OrderTypePanel: the table field belongs to dine-in alone', () => {
  it('offers it for dine-in', () => {
    setup({ orderType: 'dine_in' })
    expect(screen.getByLabelText('Table number')).not.toBeNull()
  })

  it('removes it entirely for takeaway', () => {
    setup({ orderType: 'takeaway', tableNumber: '5' })
    expect(screen.queryByLabelText('Table number')).toBeNull()
  })

  it('passes what was typed straight back up', async () => {
    const { user, onTableNumberChange } = setup({ orderType: 'dine_in' })
    await user.type(screen.getByLabelText('Table number'), 'A')
    expect(onTableNumberChange).toHaveBeenCalledWith('A')
  })
})

describe('OrderTypePanel: when it complains', () => {
  it('says nothing about an untouched field', () => {
    // An empty box on a fresh order is not yet a mistake; greeting the operator with an
    // error would be nagging rather than help.
    setup({ orderType: 'dine_in', tableNumber: '' })
    expect(screen.queryByText(/letters and numbers/i)).toBeNull()
    expect(screen.getByLabelText('Table number').getAttribute('aria-invalid')).toBe('false')
  })

  it('flags a table number that is not letters and numbers', () => {
    setup({ orderType: 'dine_in', tableNumber: 'table #5' })
    expect(screen.getByText('Use letters and numbers only, for example 5 or A3.')).not.toBeNull()
    expect(screen.getByLabelText('Table number').getAttribute('aria-invalid')).toBe('true')
  })

  it('accepts an ordinary table without complaint', () => {
    setup({ orderType: 'dine_in', tableNumber: 'A3' })
    expect(screen.getByLabelText('Table number').getAttribute('aria-invalid')).toBe('false')
  })
})
