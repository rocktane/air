import { useEffect, useState, type MouseEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import DOMPurify from 'dompurify'
import { ArrowUp, ExternalLink, Inbox, Loader2, MessageSquare } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import { Separator } from '@/components/ui/separator'
import { SourceLogo, Favicon, Thumbnail } from '@/components/source-icon'
import {
  useOpenInPane,
  usePrefetchOnHover,
  useReaderPane,
  type ReaderItem,
} from '@/components/reader-pane'
import { useActiveDigest } from '@/lib/active-digest'
import { useReads } from '@/lib/reads'
import { domainOf } from '@/lib/favicon'
import { cn, openExternal, safeHref } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

// Fallback glyph when a source has no loadable logo.
const SOURCE_EMOJI: Record<string, string> = {
  producthunt: '🔴',
  rss: '📰',
  website: '🌐',
  youtube: '▶️',
  hackernews: '🟠',
  devto: '👩‍💻',
  subreddit: '👽',
}

// Sources whose items show an up-vote count rather than a domain.
const SCORED = new Set(['producthunt', 'hackernews', 'devto', 'subreddit'])

type Layout = 'list' | 'cards' | 'grid'
type Density = 'comfortable' | 'compact'
type DisplayMode = 'title' | 'excerpt' | 'full'

// Per-source display options, resolved from the source doc with sensible
// defaults (preserves the previous behaviour when nothing is set).
type RenderOpts = {
  kind: string
  layout: Layout
  density: Density
  showImage: boolean
  showMeta: boolean
  displayMode: DisplayMode
}

function resolveOpts(source: Doc<'sources'>): RenderOpts {
  return {
    kind: source.type,
    layout: source.layout ?? (source.type === 'youtube' ? 'grid' : 'list'),
    density: source.density ?? 'comfortable',
    showImage: source.showImage ?? true,
    showMeta: source.showMeta ?? true,
    displayMode: source.displayMode ?? (source.showDescription === false ? 'title' : 'excerpt'),
  }
}

function Dashboard() {
  const { activeId, active } = useActiveDigest()
  const { data: sections, isPending } = useQuery(
    convexQuery(api.digest.latest, { digestId: activeId }),
  )
  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const filled = (sections ?? []).filter((s) => s.items.length > 0)

  return (
    <div className="space-y-8">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold">{active?.name ?? 'Mon digest'}</h1>
        <p className="text-sm text-muted-foreground capitalize">{today}</p>
      </header>

      {isPending ? (
        <p className="text-center text-sm text-muted-foreground">Chargement…</p>
      ) : filled.length === 0 ? (
        <EmptyDigest />
      ) : (
        <div className="space-y-10">
          {filled.map(({ source, items }) => (
            <SourceSection key={source._id} source={source} items={items} />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyDigest() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <Inbox className="size-8 text-muted-foreground" />
      <div>
        <p className="font-medium">Pas encore de contenu</p>
        <p className="text-sm text-muted-foreground">
          Ajoute des sources, puis clique sur « Refresh » pour collecter le contenu.
        </p>
      </div>
    </div>
  )
}

function SourceSection({ source, items }: { source: Doc<'sources'>; items: Doc<'items'>[] }) {
  const opts = resolveOpts(source)
  return (
    <section>
      <div className="mb-3 flex items-center gap-2.5">
        <SourceLogo
          source={source}
          className="size-7"
          fallback={
            <span className="text-2xl" aria-hidden>
              {SOURCE_EMOJI[source.type] ?? '•'}
            </span>
          }
        />
        <h2 className="text-lg font-semibold">{source.name}</h2>
      </div>
      <Separator className="mb-3" />

      {opts.layout === 'grid' ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          {items.map((item) => (
            <ItemCard key={item._id} item={item} opts={opts} />
          ))}
        </div>
      ) : opts.layout === 'cards' ? (
        <div className={cn('grid', opts.density === 'compact' ? 'gap-2' : 'gap-3')}>
          {items.map((item) => (
            <ItemCard key={item._id} item={item} opts={opts} bordered />
          ))}
        </div>
      ) : (
        <ul className={cn(opts.density === 'compact' ? 'space-y-2.5' : 'space-y-4')}>
          {items.map((item) => (
            <li key={item._id}>
              <DigestRow item={item} opts={opts} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Title link wiring: blogs/sites open in the reader pane on desktop (with hover
// prefetch); everything else is a plain new-tab link. Every open marks the item
// read, and honors the "open in background tab" preference for new-tab opens.
function useItemLink(item: Doc<'items'>, kind: string) {
  const openInPane = useOpenInPane()
  const { isRead, markRead, toggle } = useReads()
  const { data: settings } = useQuery(convexQuery(api.settings.get, {}))
  const background = settings?.openLinksInBackground ?? false
  const isBlog = kind === 'rss' || kind === 'website'
  const hover = usePrefetchOnHover(item.url, isBlog)
  const reader: ReaderItem = { url: item.url, title: item.title }
  const openPane = openInPane(reader)

  const onClick = (e: MouseEvent) => {
    markRead(item.url)
    // Blogs/sites open in the reader pane (desktop, plain left-click); the hook
    // preventDefaults when it takes over.
    if (isBlog) {
      openPane(e)
      if (e.defaultPrevented) return
    }
    // Remaining new-tab opens (non-blogs, or blogs on mobile): honor the
    // background-tab preference. Modifier/middle clicks keep native behavior.
    if (
      background &&
      e.button === 0 &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey &&
      !e.defaultPrevented
    ) {
      e.preventDefault()
      openExternal(item.url, true)
    }
  }
  // Middle-click opens a new tab natively — still mark the item read.
  const onAuxClick = (e: MouseEvent) => {
    if (e.button === 1) markRead(item.url)
  }

  return {
    href: safeHref(item.url),
    onClick,
    onAuxClick,
    hover,
    isBlog,
    isRead: isRead(item.url),
    toggleRead: () => toggle(item.url),
  }
}

function TitleLink({
  item,
  link,
  className,
}: {
  item: Doc<'items'>
  link: ReturnType<typeof useItemLink>
  className?: string
}) {
  return (
    <div className="flex items-start gap-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          link.toggleRead()
        }}
        aria-label={link.isRead ? 'Marquer comme non lu' : 'Marquer comme lu'}
        title={link.isRead ? 'Marquer comme non lu' : 'Marquer comme lu'}
        className={cn(
          'mt-[0.4rem] size-2 shrink-0 rounded-full border transition-colors',
          link.isRead
            ? 'border-muted-foreground/40 hover:bg-muted-foreground/20'
            : 'border-primary bg-primary hover:opacity-70',
        )}
      />
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        onClick={link.onClick}
        onAuxClick={link.onAuxClick}
        {...link.hover}
        className={cn(
          'font-medium underline-offset-4 hover:underline',
          link.isRead ? 'text-muted-foreground' : 'text-foreground',
          className,
        )}
      >
        {item.title}
      </a>
      {item.websiteUrl && (
        <a
          href={safeHref(item.websiteUrl)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Lien direct"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  )
}

// Prominent score/comments (Product Hunt, Hacker News, Reddit — not dev.to,
// which folds them into the meta line).
function Stats({
  item,
  kind,
  className,
}: {
  item: Doc<'items'>
  kind: string
  className?: string
}) {
  if (!SCORED.has(kind) || kind === 'devto') return null
  if (item.score == null && item.commentsCount == null) return null
  return (
    <div className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)}>
      {item.score != null && (
        <span className="flex items-center gap-1">
          <ArrowUp className="size-3" />
          {formatCount(item.score)}
        </span>
      )}
      {item.commentsCount != null && (
        <span className="flex items-center gap-1">
          <MessageSquare className="size-3" />
          {formatCount(item.commentsCount)}
        </span>
      )}
    </div>
  )
}

function MetaLine({
  item,
  kind,
  className,
}: {
  item: Doc<'items'>
  kind: string
  className?: string
}) {
  const isBlog = kind === 'rss' || kind === 'website'
  const isDevto = kind === 'devto'
  const domain = domainOf(item.url)
  const showDomain = !isBlog && !item.imageUrl && domain
  const showAuthor = !isBlog && item.author
  if (!(showAuthor || item.publishedAt || showDomain || isDevto)) return null
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      {showAuthor && <span className="max-w-[12rem] truncate">{item.author}</span>}
      {item.publishedAt && (
        <span>{new Date(item.publishedAt).toLocaleDateString('fr-FR')}</span>
      )}
      {isDevto && item.score != null && (
        <span className="flex items-center gap-1">
          <ArrowUp className="size-3" />
          {formatCount(item.score)}
        </span>
      )}
      {isDevto && item.commentsCount != null && (
        <span className="flex items-center gap-1">
          <MessageSquare className="size-3" />
          {formatCount(item.commentsCount)}
        </span>
      )}
      {showDomain && (
        <span className="flex items-center gap-1">
          <Favicon url={item.url} />
          {domain}
        </span>
      )}
    </div>
  )
}

// List layout: horizontal row (thumbnail left, text right). Honors the display
// mode: title only / excerpt / full article inline (blogs only).
function DigestRow({ item, opts }: { item: Doc<'items'>; opts: RenderOpts }) {
  const link = useItemLink(item, opts.kind)
  const isPH = opts.kind === 'producthunt'
  const wantExcerpt = link.isBlog ? opts.displayMode === 'excerpt' : !!item.excerpt
  const wantFull = link.isBlog && opts.displayMode === 'full'

  return (
    <article className={cn('flex items-stretch gap-3', link.isRead && 'opacity-60')}>
      {opts.showImage &&
        item.imageUrl &&
        (isPH ? <Thumbnail src={item.imageUrl} fill /> : <Thumbnail src={item.imageUrl} />)}
      <div className="flex min-w-0 flex-1 flex-col">
        <TitleLink item={item} link={link} />
        {opts.showMeta && <Stats item={item} kind={opts.kind} className="mt-0.5" />}
        {wantExcerpt && item.excerpt && (
          <p
            className={cn(
              'mt-0.5 text-sm text-muted-foreground',
              opts.density === 'compact' ? 'line-clamp-1' : 'line-clamp-2',
            )}
          >
            {item.excerpt}
          </p>
        )}
        {wantFull && <InlineArticle url={item.url} />}
        {opts.showMeta && <MetaLine item={item} kind={opts.kind} className="mt-1" />}
      </div>
    </article>
  )
}

// Card layout: vertical card (thumbnail on top). Used for the 2-per-row grid and
// the single-column "cards" layout (bordered). Full article inline is reserved
// for the list layout, so cards fall back to the excerpt.
function ItemCard({
  item,
  opts,
  bordered,
}: {
  item: Doc<'items'>
  opts: RenderOpts
  bordered?: boolean
}) {
  const link = useItemLink(item, opts.kind)
  const isVideo = opts.kind === 'youtube'
  const wantExcerpt = link.isBlog ? opts.displayMode !== 'title' : !!item.excerpt

  return (
    <article
      className={cn(
        bordered && 'overflow-hidden rounded-lg border bg-card',
        link.isRead && 'opacity-60',
      )}
    >
      {opts.showImage && item.imageUrl && (
        <a
          href={link.href}
          target="_blank"
          rel="noreferrer"
          onClick={link.onClick}
          onAuxClick={link.onAuxClick}
          {...link.hover}
          className="block"
        >
          <CardImage src={item.imageUrl} rounded={!bordered} />
        </a>
      )}
      <div className={cn(bordered ? 'p-3' : 'mt-2')}>
        <TitleLink item={item} link={link} className="text-sm" />
        {opts.showMeta && <Stats item={item} kind={opts.kind} className="mt-1" />}
        {!isVideo && wantExcerpt && item.excerpt && (
          <p
            className={cn(
              'mt-1 text-sm text-muted-foreground',
              opts.density === 'compact' ? 'line-clamp-2' : 'line-clamp-3',
            )}
          >
            {item.excerpt}
          </p>
        )}
        {opts.showMeta && <MetaLine item={item} kind={opts.kind} className="mt-1" />}
      </div>
    </article>
  )
}

function CardImage({ src, rounded }: { src: string; rounded?: boolean }) {
  const [errored, setErrored] = useState(false)
  if (errored) return null
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
      className={cn(
        'aspect-video w-full bg-muted object-cover',
        rounded && 'rounded-lg border',
      )}
    />
  )
}

// Full-article inline content (display mode "full", list layout). Reuses the
// reader-pane extraction cache so it's instant once prefetched on hover.
function InlineArticle({ url }: { url: string }) {
  const { getArticle } = useReaderPane()
  const [html, setHtml] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    getArticle(url)
      .then((a) => {
        if (!cancelled) setHtml(DOMPurify.sanitize(a.content, { ADD_ATTR: ['target'] }))
      })
      .catch(() => {
        if (!cancelled) setErrored(true)
      })
    return () => {
      cancelled = true
    }
  }, [url, getArticle])

  if (errored) return null
  if (html == null) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Chargement de l'article…
      </div>
    )
  }
  return (
    <div
      className="reader-content mt-3 border-l pl-4 text-[0.95rem]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// 1234 → "1.2k", 3_400_000 → "3.4M".
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}
