import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import {
  Archive,
  ChevronsUpDown,
  Newspaper,
  Plus,
  Rss,
  Settings as SettingsIcon,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ReaderPaneAside,
  ReaderPaneProvider,
  useReaderPane,
} from '@/components/reader-pane'
import { ActiveDigestProvider, useActiveDigest } from '@/lib/active-digest'
import { cn } from '@/lib/utils'

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
    <ReaderPaneProvider>
      <ActiveDigestProvider>
        <TooltipProvider delayDuration={200}>
          <AppShell />
        </TooltipProvider>
      </ActiveDigestProvider>
    </ReaderPaneProvider>
  )
}

// Pick / create the active digest ("brew"). Shared across Digest / Sources /
// Réglages via the ActiveDigest context.
function DigestSwitcher() {
  const { digests, activeId, active, setActiveId } = useActiveDigest()
  const createDigest = useMutation(api.digests.create)
  if (digests.length === 0) return null

  function onCreate() {
    createDigest({})
      .then((id) => {
        setActiveId(id)
        toast.success('Digest créé')
      })
      .catch(() => toast.error('Échec de la création'))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span className="max-w-[10rem] truncate">{active?.name ?? 'Digest'}</span>
          <ChevronsUpDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {digests.map((d) => (
          <DropdownMenuCheckboxItem
            key={d._id}
            checked={d._id === activeId}
            onCheckedChange={() => setActiveId(d._id)}
          >
            <span className="truncate">{d.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate}>
          <Plus className="size-4" />
          Nouveau digest
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AppShell() {
  // When the reader pane is open (desktop), the digest column shifts left and
  // the pane fills the remaining space on the right.
  const paneOpen = useReaderPane().current != null

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="shrink-0 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
              <span aria-hidden>☕️</span>
              <span>air</span>
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <DigestSwitcher />
          </div>
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
              to="/archive"
              className={navItemClass}
              activeProps={{ className: navActiveClass }}
            >
              <Archive className="size-4" />
              Archive
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

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <main
          className={cn(
            'min-w-0 flex-1 overflow-y-auto py-8 pl-4 pr-4 transition-[padding] duration-300 ease-out',
            // When the pane is open (desktop), reserve room on the right so the
            // digest recenters and shrinks in sync with the sliding pane.
            paneOpen && 'lg:pr-[clamp(23rem,44vw,49rem)]',
          )}
        >
          <div className="mx-auto max-w-3xl">
            <Outlet />
          </div>
        </main>
        <ReaderPaneAside />
      </div>

      <Toaster />
    </div>
  )
}
