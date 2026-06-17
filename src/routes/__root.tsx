import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Newspaper, Rss, Settings as SettingsIcon } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

const navItemClass =
  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
const navActiveClass = 'bg-muted text-foreground'

function RootLayout() {
  return (
    <TooltipProvider delayDuration={200}>
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden>☕️</span>
            <span>air</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/"
              activeOptions={{ exact: true }}
              className={navItemClass}
              activeProps={{ className: navActiveClass }}
            >
              <Newspaper className="size-4" />
              Digest
            </Link>
            <Link
              to="/sources"
              className={navItemClass}
              activeProps={{ className: navActiveClass }}
            >
              <Rss className="size-4" />
              Sources
            </Link>
            <Link
              to="/settings"
              className={navItemClass}
              activeProps={{ className: navActiveClass }}
            >
              <SettingsIcon className="size-4" />
              Réglages
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Outlet />
      </main>
      <Toaster />
    </div>
    </TooltipProvider>
  )
}
