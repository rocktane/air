import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useAction } from 'convex/react'
import DOMPurify from 'dompurify'
import { BookOpen, ExternalLink, Loader2, X } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { cn, safeHref } from '@/lib/utils'

export type ReaderItem = {
  url: string
  title: string
}

type Article = {
  title: string
  byline?: string
  siteName?: string
  excerpt?: string
  content: string
}

type ReaderPaneContextValue = {
  current: ReaderItem | null
  open: (item: ReaderItem) => void
  close: () => void
  getArticle: (url: string) => Promise<Article>
  prefetch: (url: string) => void
}

const ReaderPaneContext = createContext<ReaderPaneContextValue | null>(null)

export function useReaderPane() {
  const ctx = useContext(ReaderPaneContext)
  if (!ctx) throw new Error('useReaderPane must be used within ReaderPaneProvider')
  return ctx
}

export function ReaderPaneProvider({ children }: { children: ReactNode }) {
  const read = useAction(api.reader.read)
  const [current, setCurrent] = useState<ReaderItem | null>(null)
  // url → in-flight or resolved extraction, shared by hover-prefetch and open
  // so a hovered article is ready (or already loading) by the time it's clicked.
  const cache = useRef(new Map<string, Promise<Article>>())

  const getArticle = useCallback(
    (url: string) => {
      let p = cache.current.get(url)
      if (!p) {
        p = read({ url })
        cache.current.set(url, p)
      }
      return p
    },
    [read],
  )

  const prefetch = useCallback(
    (url: string) => {
      // Drop a failed prefetch so a real open can retry it.
      getArticle(url).catch(() => cache.current.delete(url))
    },
    [getArticle],
  )

  const open = useCallback((item: ReaderItem) => setCurrent(item), [])
  const close = useCallback(() => setCurrent(null), [])

  const value = useMemo(
    () => ({ current, open, close, getArticle, prefetch }),
    [current, open, close, getArticle, prefetch],
  )
  return <ReaderPaneContext.Provider value={value}>{children}</ReaderPaneContext.Provider>
}

// Click handler factory for digest links: open in the reader pane on desktop
// (plain left-click), otherwise fall through to the native target="_blank"
// (mobile, cmd/ctrl/shift/middle-click). Use only on sites/blogs.
export function useOpenInPane() {
  const { open } = useReaderPane()
  return useCallback(
    (item: ReaderItem) => (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) return
      e.preventDefault()
      open(item)
    },
    [open],
  )
}

// Hover-prefetch handlers (desktop). A short delay avoids fetching links the
// pointer merely glides over; the shared cache dedupes the eventual click.
export function usePrefetchOnHover(url: string, enabled: boolean) {
  const { prefetch } = useReaderPane()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMouseEnter = useCallback(() => {
    timer.current = setTimeout(() => prefetch(url), 120)
  }, [prefetch, url])
  const onMouseLeave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  if (!enabled) return {}
  return { onMouseEnter, onMouseLeave }
}

// Desktop-only right pane (reader mode). Always mounted so the slide animation
// plays on both open and close; the last item is kept rendered through the
// close transition, then unmounted.
export function ReaderPaneAside() {
  const { current, close } = useReaderPane()
  const open = current != null
  const [shown, setShown] = useState<ReaderItem | null>(current)
  useEffect(() => {
    if (current) setShown(current)
  }, [current])

  // Close the pane on Escape while it's open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  return (
    <aside
      aria-hidden={!open}
      onTransitionEnd={(e) => {
        // Ignore transitions bubbling up from children; unmount once the pane's
        // own close animation finishes.
        if (e.target === e.currentTarget && !open) setShown(null)
      }}
      className={cn(
        'absolute inset-y-0 right-0 z-20 hidden w-[clamp(22rem,42vw,48rem)] flex-col border-l bg-background shadow-xl transition-[transform,opacity] duration-300 ease-out lg:flex',
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0',
      )}
    >
      {shown && <ReaderPaneBody key={shown.url} item={shown} onClose={close} />}
    </aside>
  )
}

function ReaderPaneBody({ item, onClose }: { item: ReaderItem; onClose: () => void }) {
  const { getArticle } = useReaderPane()
  const [article, setArticle] = useState<Article | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Resolve the extraction as soon as the pane opens — instant if the link was
  // prefetched on hover.
  useEffect(() => {
    let cancelled = false
    setArticle(null)
    setError(null)
    getArticle(item.url)
      .then((a) => {
        if (!cancelled) setArticle(a)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Échec du chargement')
      })
    return () => {
      cancelled = true
    }
  }, [item.url, getArticle])

  // Second layer of defense over the server-side cleanup before injecting HTML.
  const safeContent = useMemo(
    () => (article ? DOMPurify.sanitize(article.content, { ADD_ATTR: ['target'] }) : ''),
    [article],
  )
  const subtitle = [article?.byline, article?.siteName].filter(Boolean).join(' · ')
  const loading = !article && !error

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <BookOpen className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={item.title}>
          {item.title}
        </p>
        <a
          href={safeHref(item.url)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Ouvrir dans un nouvel onglet"
        >
          <ExternalLink className="size-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Fermer le panneau"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <p>{error}</p>
            <a
              href={safeHref(item.url)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 underline"
            >
              Ouvrir l'original <ExternalLink className="size-3.5" />
            </a>
          </div>
        )}
        {article && (
          <article className="mx-auto max-w-2xl">
            <h1 className="text-2xl font-semibold leading-snug">
              {article.title || item.title}
            </h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
            <div
              className="reader-content mt-6"
              dangerouslySetInnerHTML={{ __html: safeContent }}
            />
          </article>
        )}
      </div>
    </>
  )
}
