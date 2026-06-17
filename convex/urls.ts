// URL normalization applied to every item before storage.

// Hostnames whose query string is part of the canonical link (the resource id
// lives in it), so stripping it would break the URL. Examples:
//   - youtube.com/watch?v=<id>
//   - news.ycombinator.com/item?id=<id>   (Ask/Show HN self-posts)
// These are skipped even when the source itself isn't whitelisted.
export const URL_QUERY_REQUIRED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'news.ycombinator.com',
]

// Remove the query string ("?…") from a URL before storage — drops tracking
// params (utm_*, fbclid, ref, …) so links stay clean. Hosts in
// URL_QUERY_REQUIRED_HOSTS and unparseable strings are returned untouched.
export function cleanItemUrl(url: string): string {
  const q = url.indexOf('?')
  if (q === -1) return url
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (URL_QUERY_REQUIRED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      return url
    }
  } catch {
    // Not an absolute URL — fall through and strip after "?".
  }
  return url.slice(0, q)
}
