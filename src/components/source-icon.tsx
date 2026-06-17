import { useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { faviconUrl, sourceIconUrl } from '@/lib/favicon'

// A source's brand logo / favicon. Falls back to `fallback` if it can't load.
export function SourceLogo({
  source,
  fallback = null,
  className,
}: {
  source: { type: string; url?: string; iconUrl?: string }
  fallback?: ReactNode
  className?: string
}) {
  const [errored, setErrored] = useState(false)
  const src = sourceIconUrl(source)
  if (!src || errored) return <>{fallback}</>
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      onError={() => setErrored(true)}
      className={cn('size-5 shrink-0 rounded-sm object-contain', className)}
    />
  )
}

// Tiny favicon for an item's source domain (shown next to the domain name).
export function Favicon({ url, className }: { url?: string | null; className?: string }) {
  const [errored, setErrored] = useState(false)
  const src = faviconUrl(url, 32)
  if (!src || errored) return null
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      onError={() => setErrored(true)}
      className={cn('size-3.5 shrink-0 rounded-[2px] object-contain', className)}
    />
  )
}

// Item thumbnail (Product Hunt square, YouTube 16:9). Hides itself on error.
export function Thumbnail({
  src,
  wide = false,
  fill = false,
  className,
}: {
  src: string
  wide?: boolean
  fill?: boolean // square that fills the row's full height
  className?: string
}) {
  const [errored, setErrored] = useState(false)
  if (errored) return null
  // Fill mode: a fixed square the image covers. A previous version sized the
  // square off the row's stretched height via `aspect-square self-stretch`, but
  // a flex item's width (main axis) is resolved before its stretched height, so
  // there was no definite height for `aspect-ratio` to turn into a width — the
  // square collapsed to 0px wide and the image vanished. Product Hunt rows are a
  // uniform height, so a fixed 64px square matches them exactly and reliably.
  if (fill) {
    return (
      <div
        className={cn(
          'relative size-16 shrink-0 overflow-hidden rounded-md border bg-muted',
          className,
        )}
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setErrored(true)}
          className="absolute inset-0 size-full object-cover"
        />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
      className={cn(
        'shrink-0 rounded-md border bg-muted object-cover',
        wide ? 'aspect-video w-28' : 'size-11',
        className,
      )}
    />
  )
}
