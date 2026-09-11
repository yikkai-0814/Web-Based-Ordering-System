import { useContext } from 'react'

import { StaffSessionContext, type StaffSessionValue } from '@/features/staff/staff-context'

export function useStaffSession(): StaffSessionValue {
  const value = useContext(StaffSessionContext)
  if (!value) throw new Error('useStaffSession must be used inside <StaffSessionProvider>')
  return value
}
