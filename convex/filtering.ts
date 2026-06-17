import type { Doc } from './_generated/dataModel'

// Only allow http/https URLs in an href (item links come from external feeds;
// a `javascript:` URL would be an XSS vector). Returns undefined otherwise.
export function safeHref(url?: string | null): string | undefined {
  if (!url) return undefined
  try {
    const p = new URL(url)
    return p.protocol === 'http:' || p.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

// Normalize a URL for cross-source dedup: lowercase host (sans www), strip the
// trailing slash, drop query/hash. Returns the trimmed input on parse failure.
export function dedupeKey(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    const path = u.pathname.replace(/\/+$/, '')
    return `${host}${path}`.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

// Keyword / score filters, carried by both digests (global) and sources.
export type Filters = {
  includeKeywords?: string[]
  excludeKeywords?: string[]
  minScore?: number
}

// Decide whether to keep an item, combining digest-level and source-level
// filters. Keyword match is case-insensitive over title + excerpt. minScore only
// applies to items that actually carry a score (so it never drops blog posts).
export function keepItem(item: Doc<'items'>, digest: Filters, source: Filters): boolean {
  const haystack = `${item.title} ${item.excerpt ?? ''}`.toLowerCase()

  const includes = [...(digest.includeKeywords ?? []), ...(source.includeKeywords ?? [])]
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
  if (includes.length > 0 && !includes.some((k) => haystack.includes(k))) return false

  const excludes = [...(digest.excludeKeywords ?? []), ...(source.excludeKeywords ?? [])]
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
  if (excludes.some((k) => haystack.includes(k))) return false

  const minScore = Math.max(digest.minScore ?? 0, source.minScore ?? 0)
  if (minScore > 0 && item.score != null && item.score < minScore) return false

  return true
}
