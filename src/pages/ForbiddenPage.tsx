import { Link } from 'react-router'
import { ShieldOff } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function ForbiddenPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <ShieldOff className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">Not allowed</h1>
      <p className="text-muted-foreground">
        Your account does not have access to this page. If you think it should, ask an administrator
        to change your role.
      </p>
      <Button asChild size="lg" className="h-touch text-base">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  )
}
