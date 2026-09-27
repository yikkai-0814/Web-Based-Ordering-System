/**
 * The handoff between the Orders list and the queue board: what one page leaves for the next.
 *
 * The rule that matters is the lifetime. A result is available only while some page showing
 * that date is still mounted, so a page opened in its place can start from it, and it is gone
 * the moment the last such page leaves — which is what makes a stale board impossible without
 * any timer deciding how old is too old.
 */
import { describe, expect, it } from 'vitest'

import type { OrderView } from '@/features/pos/orders-view'
import { holdWorkspace, recallWorkspace, rememberWorkspace } from '@/features/pos/workspace-handoff'

const views = (label: string) => [{ label }] as unknown as OrderView[]

describe('workspace handoff', () => {
  it('offers nothing for a date no page is showing', () => {
    rememberWorkspace('2026-01-01', views('ignored'))
    expect(recallWorkspace('2026-01-01')).toBeNull()
  })

  it('offers the latest complete result while a page holds the date', () => {
    const release = holdWorkspace('2026-01-02')
    expect(recallWorkspace('2026-01-02')).toBeNull()

    rememberWorkspace('2026-01-02', views('first'))
    rememberWorkspace('2026-01-02', views('second'))
    expect(recallWorkspace('2026-01-02')).toEqual(views('second'))

    release()
  })

  it('keeps it through a switch, while the page being left is still mounted', () => {
    // React renders the page being opened before it unmounts the one being left.
    const leaving = holdWorkspace('2026-01-03')
    rememberWorkspace('2026-01-03', views('board'))

    const handedOver = recallWorkspace('2026-01-03') // the new page's first render
    const arriving = holdWorkspace('2026-01-03') // its effect
    leaving() // the old page's cleanup

    expect(handedOver).toEqual(views('board'))
    expect(recallWorkspace('2026-01-03')).toEqual(views('board'))
    arriving()
  })

  it('forgets the date as soon as the last page showing it leaves', () => {
    const release = holdWorkspace('2026-01-04')
    rememberWorkspace('2026-01-04', views('board'))
    release()

    expect(recallWorkspace('2026-01-04')).toBeNull()
  })

  it('keeps each date separate', () => {
    const today = holdWorkspace('2026-01-05')
    const yesterday = holdWorkspace('2026-01-06')
    rememberWorkspace('2026-01-05', views('today'))

    expect(recallWorkspace('2026-01-06')).toBeNull()
    expect(recallWorkspace('2026-01-05')).toEqual(views('today'))
    today()
    yesterday()
  })
})
