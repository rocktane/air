import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { ArrowUp, MessageSquare, Inbox, ExternalLink } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import { Separator } from '@/components/ui/separator'
import { SourceLogo, Favicon, Thumbnail } from '@/components/source-icon'
import { useOpenInPane, usePrefetchOnHover } from '@/components/reader-pane'
import { useActiveDigest } from '@/lib/active-digest'
import { domainOf } from '@/lib/favicon'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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

function SourceSection({
  source,
  items,
}: {
  source: Doc<'sources'>
  items: Doc<'items'>[]
}) {
  const isVideo = source.type === 'youtube'
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
      {isVideo ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          {items.map((item) => (
            <VideoCard key={item._id} item={item} />
          ))}
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item._id}>
              <DigestRow
                item={item}
                kind={source.type}
                showDescription={source.showDescription}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// YouTube layout: 2 per row, thumbnail on top, title then date below — no blurb.
function VideoCard({ item }: { item: Doc<'items'> }) {
  // Videos open in a new tab (reader mode is meaningless for them).
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="group block"
    >
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          className="aspect-video w-full rounded-lg border bg-muted object-cover"
        />
      )}
      <p className="mt-2 line-clamp-2 text-sm font-medium underline-offset-4 group-hover:underline">
        {item.title}
      </p>
      {item.publishedAt && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {new Date(item.publishedAt).toLocaleDateString('fr-FR')}
        </p>
      )}
    </a>
  )
}

function DigestRow({
  item,
  kind,
  showDescription,
}: {
  item: Doc<'items'>
  kind: string
  showDescription?: boolean
}) {
  const scored = SCORED.has(kind)
  const isPH = kind === 'producthunt'
  const domain = domainOf(item.url)
  const openInPane = useOpenInPane()
  const onTitleClick = openInPane({ url: item.url, title: item.title })
  // Only blogs/sites open in the reader pane; everything else stays a new-tab link.
  const hover = usePrefetchOnHover(item.url, kind === 'rss' || kind === 'website')
  // Blogs/sites keep only the date underneath. Other sources also surface the
  // author and (when there's no thumbnail) the article domain.
  const isBlog = kind === 'rss' || kind === 'website'
  // dev.to shows its stats next to the date (in the meta line) instead of
  // under the name like Product Hunt / Hacker News / Reddit.
  const isDevto = kind === 'devto'
  // Blogs/sites can hide their description via a per-source toggle.
  const hideExcerpt = isBlog && showDescription === false
  const showDomain = !isBlog && !item.imageUrl && domain
  const showAuthor = !isBlog && item.author
  const hasStats = scored && !isDevto && (item.score != null || item.commentsCount != null)

  return (
    <article className="group flex items-stretch gap-3">
      {item.imageUrl &&
        (isPH ? (
          <Thumbnail src={item.imageUrl} fill />
        ) : (
          <Thumbnail src={item.imageUrl} />
        ))}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          {kind === 'producthunt' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-foreground underline-offset-4 group-hover:underline"
                >
                  {item.title}
                </a>
              </TooltipTrigger>
              <TooltipContent>Lien vers la page Product Hunt</TooltipContent>
            </Tooltip>
          ) : (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              {...hover}
              onClick={isBlog ? onTitleClick : undefined}
              className="font-medium text-foreground underline-offset-4 group-hover:underline"
            >
              {item.title}
            </a>
          )}
          {item.websiteUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={item.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Lien direct"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              </TooltipTrigger>
              <TooltipContent>Lien direct</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Stats directly under the name (Product Hunt, Hacker News, …). */}
        {hasStats && (
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
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
        )}

        {item.excerpt && !hideExcerpt && (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {item.excerpt}
          </p>
        )}

        {(showAuthor || item.publishedAt || showDomain || isDevto) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {showAuthor && (
              <span className="max-w-[12rem] truncate">{item.author}</span>
            )}
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
        )}
      </div>
    </article>
  )
}

// 1234 → "1.2k", 3_400_000 → "3.4M".
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}
