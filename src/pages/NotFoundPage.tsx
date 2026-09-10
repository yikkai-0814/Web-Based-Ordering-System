import { Link } from 'react-router'
import { FileQuestion } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <FileQuestion className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">That address does not match anything in the app.</p>
      <Button asChild size="lg" className="h-touch text-base">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  )
}
