// Helpers to derive brand logos / favicons for sources and items, Mailbrew-style.

// Branded sources have a fixed logo domain regardless of their (optional) url.
const BRAND_DOMAIN: Record<string, string> = {
  producthunt: 'producthunt.com',
  hackernews: 'news.ycombinator.com',
  youtube: 'youtube.com',
  devto: 'dev.to',
  subreddit: 'reddit.com',
}

// Extract a bare hostname (without `www.`) from a url or domain-ish string.
export function domainOf(url?: string | null): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

// Google's favicon service: reliable, cached, and works for any public domain.
export function faviconUrl(urlOrDomain?: string | null, size = 64): string | undefined {
  const domain = domainOf(urlOrDomain)
  if (!domain) return undefined
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`
}

// The logo to show for a source: explicit iconUrl > brand logo > url favicon.
export function sourceIconUrl(source: {
  type: string
  url?: string
  iconUrl?: string
}): string | undefined {
  if (source.iconUrl) return source.iconUrl
  return faviconUrl(BRAND_DOMAIN[source.type] ?? source.url)
}
