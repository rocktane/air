'use node'

import { action, internalAction } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { v } from 'convex/values'
import Parser from 'rss-parser'
import * as cheerio from 'cheerio'
import { cleanItemUrl } from './urls'

// Convex's runtime exposes env vars at runtime; declare the type for TS.
declare const process: { env: Record<string, string | undefined> }

const UA = 'air/0.1 (personal newsletter reader)'

// Normalized item produced by a fetcher (matches convex/items.ts `itemInput`).
type NormalizedItem = {
  externalId: string
  title: string
  url: string
  author?: string
  publishedAt?: number
  score?: number
  commentsCount?: number
  excerpt?: string
  imageUrl?: string
  websiteUrl?: string // e.g. Product Hunt's official product site
}

// Cached extraction recipe for a website without RSS (mirrors schema.ts `websiteStrategy`).
type WebsiteStrategy =
  | { kind: 'feed'; url: string }
  | { kind: 'wpApi'; base: string }
  | { kind: 'jsonld'; listUrl: string }
  | {
      kind: 'selectors'
      listUrl: string
      item: string
      title: string
      link: string
      date?: string
      excerpt?: string
    }

type SelectorRecipe = Omit<Extract<WebsiteStrategy, { kind: 'selectors' }>, 'kind' | 'listUrl'>

// Fetch one source's latest content and upsert it into `items`. Shared by the
// public `refreshSource` action and the `refreshAll` batch action. The website
// cascade's LLM tier only runs when `allowLlm` is set (the manual scan) — every
// other path is free and runs automatically.
async function refreshOne(
  ctx: ActionCtx,
  sourceId: Id<'sources'>,
  opts: { allowLlm: boolean } = { allowLlm: false },
): Promise<{
  total: number
  inserted: number
  strategy: WebsiteStrategy['kind'] | null
  needsManualScan: boolean
}> {
  const source = await ctx.runQuery(internal.sources.get, { id: sourceId })
  if (!source) throw new Error('Source introuvable')

  let items: NormalizedItem[]
  let newStrategy: WebsiteStrategy | undefined
  let strategyKind: WebsiteStrategy['kind'] | null = null
  let needsManualScan = false

  switch (source.type) {
    case 'producthunt':
      items = await fetchProductHunt()
      break
    case 'rss':
      if (!source.url) throw new Error('URL du flux RSS manquante')
      items = await parseFeed(source.url)
      break
    case 'hackernews':
      items = await fetchHackerNews()
      break
    case 'devto':
      items = await fetchDevTo(source.url)
      break
    case 'youtube':
      if (!source.url) throw new Error('URL de la chaîne YouTube manquante')
      items = await fetchYoutube(source.url, source.includeShorts ?? true)
      break
    case 'subreddit':
      items = await fetchSubreddit(source.url)
      break
    case 'website': {
      if (!source.url) throw new Error('URL du site manquante')
      const existing = source.strategy as WebsiteStrategy | undefined
      if (existing) {
        // Replay the cached recipe (cheap, no LLM).
        items = await fetchWithStrategy(existing)
        strategyKind = existing.kind
      } else {
        items = []
      }
      // No recipe (or a stale one yielding nothing) → try the free tiers. The
      // LLM tier is the last resort and only runs on an explicit manual scan.
      if (items.length === 0) {
        const free = await analyzeWebsiteFree(source.url)
        if (free) {
          items = free.items
          newStrategy = free.strategy
          strategyKind = free.strategy.kind
        } else if (opts.allowLlm) {
          const llm = await analyzeWebsiteLlm(source.url)
          if (!llm) {
            throw new Error(
              'Scan impossible : ni flux, ni API CMS, ni JSON-LD, ni sélecteur fiable trouvé.',
            )
          }
          items = llm.items
          newStrategy = llm.strategy
          strategyKind = llm.strategy.kind
        } else {
          // Free extraction failed — defer to a manual scan instead of spending
          // an LLM call automatically.
          needsManualScan = true
        }
      }
      break
    }
    default:
      throw new Error(`Fetcher pas encore implémenté pour « ${source.type} »`)
  }

  if (newStrategy) {
    await ctx.runMutation(internal.sources.setStrategy, {
      id: sourceId,
      strategy: newStrategy,
    })
  }
  if (source.type === 'website') {
    await ctx.runMutation(internal.sources.setNeedsManualScan, {
      id: sourceId,
      value: needsManualScan,
    })
  }

  // Strip tracking params from item links before storage, unless this source
  // is whitelisted (preserveUrlParams). The dedup key (externalId) is left
  // untouched — some feeds put a real id in the query (e.g. WordPress `?p=`).
  const storedItems = source.preserveUrlParams
    ? items
    : items.map((it) => ({
        ...it,
        url: cleanItemUrl(it.url),
        websiteUrl: it.websiteUrl ? cleanItemUrl(it.websiteUrl) : undefined,
      }))

  // Explicit type annotation to avoid Convex's circular type inference.
  const result: { total: number; inserted: number } = await ctx.runMutation(
    internal.items.upsertMany,
    { sourceId, items: storedItems },
  )

  // Shorts turned off: also drop any Shorts cached from a previous fetch.
  if (source.type === 'youtube' && !(source.includeShorts ?? true)) {
    await ctx.runMutation(internal.items.pruneShorts, { sourceId })
  }

  return { ...result, strategy: strategyKind, needsManualScan }
}

// Public action: refresh one source on demand. The UI's ↻ button leaves
// `allowLlm` off (free only); the "Scan manuel" button sets it.
export const refreshSource = action({
  args: { sourceId: v.id('sources'), allowLlm: v.optional(v.boolean()) },
  handler: (ctx, { sourceId, allowLlm }) =>
    refreshOne(ctx, sourceId, { allowLlm: allowLlm ?? false }),
})

// Refresh every enabled source, best-effort — one source failing doesn't stop
// the rest. Used for a one-shot rebuild and as the future cron entry point.
export const refreshAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.runQuery(api.sources.list, {})
    const results: {
      name: string
      ok: boolean
      inserted?: number
      total?: number
      error?: string
    }[] = []
    for (const s of sources) {
      if (!s.enabled) continue
      try {
        const r = await refreshOne(ctx, s._id)
        results.push({ name: s.name, ok: true, inserted: r.inserted, total: r.total })
      } catch (e) {
        results.push({
          name: s.name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    return results
  },
})

// --- Product Hunt -----------------------------------------------------------

async function getProductHuntToken(): Promise<string> {
  const devToken = process.env.PRODUCT_HUNT_TOKEN
  if (devToken) return devToken

  const client_id = process.env.PRODUCT_HUNT_API_KEY
  const client_secret = process.env.PRODUCT_HUNT_API_SECRET
  if (!client_id || !client_secret) {
    throw new Error(
      'Product Hunt: aucun identifiant (PRODUCT_HUNT_TOKEN ou PRODUCT_HUNT_API_KEY/SECRET)',
    )
  }
  const res = await fetch('https://api.producthunt.com/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id, client_secret, grant_type: 'client_credentials' }),
  })
  if (!res.ok) throw new Error(`Product Hunt OAuth ${res.status}`)
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

type PHNode = {
  id: string
  name: string
  tagline?: string
  votesCount?: number
  commentsCount?: number
  url: string
  website?: string | null
  thumbnail?: { url?: string } | null
}

async function fetchProductHunt(): Promise<NormalizedItem[]> {
  const token = await getProductHuntToken()
  const query = `
    query TopPosts {
      posts(order: VOTES, first: 15) {
        edges {
          node { id name tagline votesCount commentsCount url website thumbnail { url } }
        }
      }
    }`
  const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Product Hunt GraphQL ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    data?: { posts?: { edges?: { node: PHNode }[] } }
    errors?: { message: string }[]
  }
  if (json.errors?.length) throw new Error(`Product Hunt: ${json.errors[0].message}`)
  const edges = json.data?.posts?.edges ?? []
  return edges.map(({ node }) => ({
    externalId: String(node.id),
    title: node.name,
    url: node.url,
    excerpt: node.tagline || undefined,
    score: node.votesCount,
    commentsCount: node.commentsCount,
    imageUrl: node.thumbnail?.url || undefined,
    websiteUrl: node.website || undefined,
  }))
}

// --- RSS / Atom -------------------------------------------------------------

const rssParser = new Parser()

async function parseFeed(url: string): Promise<NormalizedItem[]> {
  const xml = await fetchText(url, 'feed')
  const feed = await rssParser.parseString(xml)
  return (feed.items ?? [])
    .slice(0, 20)
    .map((item): NormalizedItem => {
      const link = item.link ?? ''
      const dateStr = item.isoDate || item.pubDate
      return {
        externalId: item.guid || link || item.title || '',
        title: item.title ?? '(sans titre)',
        url: link,
        author:
          item.creator || (item as { author?: string }).author || feed.title || undefined,
        publishedAt: dateStr ? Date.parse(dateStr) || undefined : undefined,
        excerpt: cleanExcerpt(
          item.contentSnippet ||
            item.content ||
            (item as { summary?: string }).summary ||
            '',
        ),
      }
    })
    .filter((it) => it.url !== '' && it.externalId !== '')
}

// --- Hacker News ------------------------------------------------------------

// Algolia's HN Search API is free, key-less, and returns the live front page
// (points + comment counts) in a single request.
type HnHit = {
  objectID: string
  title?: string
  url?: string | null
  author?: string
  points?: number
  num_comments?: number
  created_at_i?: number
  story_text?: string | null
}

async function fetchHackerNews(): Promise<NormalizedItem[]> {
  const res = await fetch(
    'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30',
    { headers: { 'User-Agent': UA, Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`Hacker News ${res.status}`)
  const json = (await res.json()) as { hits?: HnHit[] }
  return (json.hits ?? [])
    .filter((h) => h.title)
    .map((h): NormalizedItem => {
      const discussion = `https://news.ycombinator.com/item?id=${h.objectID}`
      return {
        externalId: h.objectID,
        title: h.title ?? '(sans titre)',
        // Link the article; Ask/Show HN posts have no url → the discussion.
        url: h.url || discussion,
        author: h.author,
        publishedAt: h.created_at_i ? h.created_at_i * 1000 : undefined,
        score: h.points,
        commentsCount: h.num_comments,
        excerpt: cleanExcerpt(h.story_text ?? ''),
      }
    })
}

// --- dev.to (Forem API) -----------------------------------------------------

type DevtoArticle = {
  id?: number
  title?: string
  description?: string
  url?: string
  cover_image?: string | null
  social_image?: string | null
  published_at?: string
  published_timestamp?: string
  positive_reactions_count?: number
  comments_count?: number
  user?: { name?: string; username?: string }
}

// Turn the optional source URL into dev.to API query params (tag or username).
function devtoQuery(input?: string): string {
  const base = 'per_page=20'
  if (!input?.trim()) return `${base}&top=7` // no filter → top of the last week
  const trimmed = input.trim()
  const tag = trimmed.match(/dev\.to\/t\/([^/?#]+)/i)
  if (tag) return `${base}&tag=${encodeURIComponent(tag[1])}`
  const user = trimmed.match(/dev\.to\/([^/?#]+)/i)
  if (user && user[1] !== 'api') return `${base}&username=${encodeURIComponent(user[1])}`
  if (/^[\w-]+$/.test(trimmed)) return `${base}&tag=${encodeURIComponent(trimmed)}` // bare word → tag
  return `${base}&top=7`
}

async function fetchDevTo(input?: string): Promise<NormalizedItem[]> {
  const res = await fetch(`https://dev.to/api/articles?${devtoQuery(input)}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`dev.to ${res.status}`)
  const articles = (await res.json()) as DevtoArticle[]
  if (!Array.isArray(articles)) throw new Error('Réponse dev.to inattendue')
  return articles
    .map((a): NormalizedItem => {
      const dateStr = a.published_timestamp || a.published_at
      return {
        externalId: String(a.id ?? a.url ?? ''),
        title: a.title ?? '(sans titre)',
        url: a.url ?? '',
        author: a.user?.name || a.user?.username || undefined,
        publishedAt: dateStr ? Date.parse(dateStr) || undefined : undefined,
        score: a.positive_reactions_count,
        commentsCount: a.comments_count,
        excerpt: a.description ? cleanExcerpt(a.description) : undefined,
        imageUrl: a.cover_image || a.social_image || undefined,
      }
    })
    .filter((it) => it.url !== '' && it.externalId !== '')
}

// --- YouTube ----------------------------------------------------------------

type YtMediaGroup = {
  'media:description'?: string[]
  'media:thumbnail'?: { $?: { url?: string } }[]
  'media:community'?: { 'media:statistics'?: { $?: { views?: string } }[] }[]
}
type YtItemFields = { ytVideoId?: string; mediaGroup?: YtMediaGroup }

// rss-parser configured for YouTube's Atom feed (video id + media extensions).
const youtubeParser = new Parser<unknown, YtItemFields>({
  customFields: {
    item: [
      ['yt:videoId', 'ytVideoId'],
      ['media:group', 'mediaGroup'],
    ],
  },
})

const YT_ID_RE = /^UC[\w-]{20,}$/
const YT_CHANNEL_IN_URL_RE = /channel\/(UC[\w-]{20,})/

// xml2js may or may not wrap single children in arrays — tolerate both.
function firstOf<T>(x: T[] | T | undefined): T | undefined {
  if (x === undefined) return undefined
  return Array.isArray(x) ? x[0] : x
}

// Resolve a channel URL / @handle / raw id to a UC… channel id.
async function resolveYoutubeChannelId(input: string): Promise<string> {
  const trimmed = input.trim()
  if (YT_ID_RE.test(trimmed)) return trimmed
  const inUrl = trimmed.match(YT_CHANNEL_IN_URL_RE)
  if (inUrl) return inUrl[1]

  // @handle, /c/<name>, /user/<name> → scrape the channel page for its id.
  const pageUrl = trimmed.startsWith('http')
    ? trimmed
    : `https://www.youtube.com/${trimmed.replace(/^\//, '')}`
  const html = await fetchText(pageUrl, 'html')
  const m =
    html.match(/"(?:channelId|externalId)":"(UC[\w-]{20,})"/) ||
    html.match(/channel\/(UC[\w-]{20,})/)
  if (!m) throw new Error("Impossible de trouver l'identifiant de la chaîne YouTube")
  return m[1]
}

async function fetchYoutube(
  input: string,
  includeShorts: boolean,
): Promise<NormalizedItem[]> {
  const channelId = await resolveYoutubeChannelId(input)
  const xml = await fetchText(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    'feed',
  )
  const feed = await youtubeParser.parseString(xml)

  const items = (feed.items ?? [])
    .slice(0, 15)
    .map((item): NormalizedItem => {
      const videoId = item.ytVideoId || (item.guid ?? '').split(':').pop() || ''
      const group = item.mediaGroup
      const views = firstOf(firstOf(group?.['media:community'])?.['media:statistics'])?.$?.views
      // hqdefault always exists for public videos — the reliable thumbnail.
      const thumb = videoId
        ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        : firstOf(group?.['media:thumbnail'])?.$?.url
      const dateStr = item.isoDate || item.pubDate
      return {
        externalId: videoId || item.guid || item.link || item.title || '',
        title: item.title ?? '(sans titre)',
        url: item.link || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
        author:
          (item as { author?: string }).author || item.creator || feed.title || undefined,
        publishedAt: dateStr ? Date.parse(dateStr) || undefined : undefined,
        score: views ? Number(views) || undefined : undefined,
        excerpt: cleanExcerpt(firstOf(group?.['media:description']) ?? ''),
        imageUrl: thumb,
      }
    })
    .filter((it) => it.url !== '' && it.externalId !== '')

  if (includeShorts) return items
  // The feed links Shorts as /shorts/<id> and normal videos as /watch?v=<id>,
  // so the URL path alone tells them apart — no extra requests needed.
  return items.filter((it) => !it.url.includes('/shorts/'))
}

// --- Reddit (subreddit) -----------------------------------------------------

type RedditPost = {
  id: string
  title?: string
  url?: string
  permalink: string
  author?: string
  created_utc?: number
  score?: number
  num_comments?: number
  selftext?: string
  thumbnail?: string
  preview?: { images?: { source?: { url?: string } }[] }
}

// Accept r/<sub>, a full reddit URL, or a bare subreddit name.
function parseSubreddit(input: string): string {
  const trimmed = input.trim()
  const m =
    trimmed.match(/reddit\.com\/r\/([^/?#]+)/i) || trimmed.match(/^\/?r\/([^/?#]+)/i)
  if (m) return m[1]
  if (/^[\w-]+$/.test(trimmed)) return trimmed
  throw new Error('Subreddit invalide')
}

async function fetchSubreddit(input?: string): Promise<NormalizedItem[]> {
  if (!input) throw new Error('Subreddit manquant')
  const sub = parseSubreddit(input)
  const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=25`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Reddit ${res.status}`)
  const json = (await res.json()) as { data?: { children?: { data: RedditPost }[] } }
  return (json.data?.children ?? [])
    .map(({ data }): NormalizedItem => {
      const previewUrl = data.preview?.images?.[0]?.source?.url
      const image = previewUrl
        ? decodeEntities(previewUrl)
        : typeof data.thumbnail === 'string' && data.thumbnail.startsWith('http')
          ? data.thumbnail
          : undefined
      return {
        externalId: data.id,
        title: decodeEntities(data.title ?? '') || '(sans titre)',
        url: data.url || `https://www.reddit.com${data.permalink}`,
        author: data.author ? `u/${data.author}` : undefined,
        publishedAt: data.created_utc ? data.created_utc * 1000 : undefined,
        score: data.score,
        commentsCount: data.num_comments,
        excerpt: cleanExcerpt(data.selftext ?? ''),
        imageUrl: image,
      }
    })
    .filter((it) => it.url !== '' && it.externalId !== '')
}

// --- Website (no RSS): the cascade ------------------------------------------

// Free tiers of the cascade (no LLM): hidden feed, WordPress REST API, JSON-LD.
// Returns the first strategy that yields items, or null if none do.
async function analyzeWebsiteFree(
  url: string,
): Promise<{ strategy: WebsiteStrategy; items: NormalizedItem[] } | null> {
  const html = await fetchText(url, 'html')
  const origin = new URL(url).origin

  // Tier 0a — hidden feed declared in <link rel="alternate"> + common paths.
  const declared = discoverFeedUrl(html, url)
  const feedCandidates = [
    ...(declared ? [declared] : []),
    ...['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'].map(
      (p) => origin + p,
    ),
  ]
  for (const candidate of feedCandidates) {
    try {
      const items = await parseFeed(candidate)
      if (items.length > 0) return { strategy: { kind: 'feed', url: candidate }, items }
    } catch {
      /* try next candidate */
    }
  }

  // Tier 0c — WordPress REST API.
  try {
    const items = await fetchWpApi(origin)
    if (items.length > 0) return { strategy: { kind: 'wpApi', base: origin }, items }
  } catch {
    /* not WordPress */
  }

  // Tier 0d — schema.org JSON-LD embedded in the page.
  const jsonldItems = extractJsonLd(html, url)
  if (jsonldItems.length > 0) {
    return { strategy: { kind: 'jsonld', listUrl: url }, items: jsonldItems }
  }

  return null
}

// LLM tier (last resort): synthesize CSS selectors via OpenRouter, validated by
// running them. Returns null if the model can't produce a usable recipe.
async function analyzeWebsiteLlm(
  url: string,
): Promise<{ strategy: WebsiteStrategy; items: NormalizedItem[] } | null> {
  const html = await fetchText(url, 'html')
  const recipe = await llmSynthesizeSelectors(html, url)
  if (recipe) {
    const items = applySelectors(html, { ...recipe, listUrl: url }, url)
    if (items.length >= 2) {
      return { strategy: { kind: 'selectors', listUrl: url, ...recipe }, items }
    }
  }
  return null
}

// Cheap replay of a previously-found recipe (no LLM).
async function fetchWithStrategy(strategy: WebsiteStrategy): Promise<NormalizedItem[]> {
  switch (strategy.kind) {
    case 'feed':
      return parseFeed(strategy.url)
    case 'wpApi':
      return fetchWpApi(strategy.base)
    case 'jsonld': {
      const html = await fetchText(strategy.listUrl, 'html')
      return extractJsonLd(html, strategy.listUrl)
    }
    case 'selectors': {
      const html = await fetchText(strategy.listUrl, 'html')
      return applySelectors(html, strategy, strategy.listUrl)
    }
  }
}

function discoverFeedUrl(html: string, baseUrl: string): string | undefined {
  const $ = cheerio.load(html)
  const href = $(
    'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]',
  )
    .first()
    .attr('href')
  if (!href) return undefined
  try {
    return new URL(href, baseUrl).href
  } catch {
    return undefined
  }
}

async function fetchWpApi(origin: string): Promise<NormalizedItem[]> {
  const res = await fetch(`${origin}/wp-json/wp/v2/posts?per_page=20`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`WordPress API ${res.status}`)
  const posts = (await res.json()) as Array<{
    id?: number
    link?: string
    date_gmt?: string
    date?: string
    title?: { rendered?: string }
    excerpt?: { rendered?: string }
  }>
  if (!Array.isArray(posts)) throw new Error('Réponse WordPress inattendue')
  return posts
    .map((p): NormalizedItem => {
      const dateStr = p.date_gmt ? `${p.date_gmt}Z` : p.date
      return {
        externalId: String(p.id ?? p.link ?? ''),
        title: decodeEntities(stripTags(p.title?.rendered ?? '')) || '(sans titre)',
        url: p.link ?? '',
        publishedAt: dateStr ? Date.parse(dateStr) || undefined : undefined,
        excerpt: cleanExcerpt(p.excerpt?.rendered ?? ''),
      }
    })
    .filter((it) => it.url !== '')
}

// JSON-LD: pull Article/BlogPosting/NewsArticle (and ItemList entries) from the page.
function extractJsonLd(html: string, baseUrl: string): NormalizedItem[] {
  const $ = cheerio.load(html)
  const items: NormalizedItem[] = []

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text()
    if (!raw) return
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      return
    }
    for (const node of collectJsonLdNodes(data)) {
      const types = ([] as string[]).concat(node['@type'] ?? []).map(String)
      if (types.some((t) => /Article|BlogPosting|NewsArticle|Posting/i.test(t))) {
        pushJsonLdItem(items, node, baseUrl)
      }
      if (types.some((t) => /ItemList/i.test(t)) && Array.isArray(node.itemListElement)) {
        for (const entry of node.itemListElement) {
          pushJsonLdItem(items, entry?.item ?? entry, baseUrl)
        }
      }
    }
  })

  return dedupeByUrl(items).slice(0, 20)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectJsonLdNodes(data: any): any[] {
  if (Array.isArray(data)) return data.flatMap(collectJsonLdNodes)
  if (data && typeof data === 'object') {
    const nested = Array.isArray(data['@graph']) ? data['@graph'].flatMap(collectJsonLdNodes) : []
    return [data, ...nested]
  }
  return []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pushJsonLdItem(items: NormalizedItem[], node: any, baseUrl: string): void {
  if (!node || typeof node !== 'object') return
  const rawUrl =
    node.url || node.mainEntityOfPage?.['@id'] || node.mainEntityOfPage || node['@id']
  const title = node.headline || node.name
  if (!rawUrl || !title) return
  let url: string
  try {
    url = new URL(String(rawUrl), baseUrl).href
  } catch {
    return
  }
  items.push({
    externalId: url,
    title: decodeEntities(String(title)).trim() || '(sans titre)',
    url,
    publishedAt: node.datePublished ? Date.parse(node.datePublished) || undefined : undefined,
    excerpt: node.description ? cleanExcerpt(String(node.description)) : undefined,
  })
}

// Apply LLM-synthesized (or cached) CSS selectors to the listing page.
function applySelectors(
  html: string,
  recipe: SelectorRecipe & { listUrl: string },
  baseUrl: string,
): NormalizedItem[] {
  const $ = cheerio.load(html)
  const items: NormalizedItem[] = []

  $(recipe.item).each((_, el) => {
    const $el = $(el)
    const title = (recipe.title ? $el.find(recipe.title).first() : $el).text().trim()
    const $link = recipe.link ? $el.find(recipe.link).first() : $el.find('a').first()
    const href = $link.attr('href') || $link.closest('a').attr('href') || $el.find('a').first().attr('href')
    if (!title || !href) return
    let url: string
    try {
      url = new URL(href, baseUrl).href
    } catch {
      return
    }
    const dateRaw = recipe.date
      ? $el.find(recipe.date).first().attr('datetime') || $el.find(recipe.date).first().text().trim()
      : undefined
    items.push({
      externalId: url,
      title: decodeEntities(title),
      url,
      publishedAt: dateRaw ? Date.parse(dateRaw) || undefined : undefined,
      excerpt: recipe.excerpt ? cleanExcerpt($el.find(recipe.excerpt).first().text()) : undefined,
    })
  })

  return dedupeByUrl(items).slice(0, 20)
}

// LLM tier — ask OpenRouter (DeepSeek by default) for CSS selectors. Returns
// null if the model can't produce a usable recipe.
async function llmSynthesizeSelectors(
  html: string,
  listUrl: string,
): Promise<SelectorRecipe | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY manquant — pose ta clé OpenRouter sur Convex (bunx convex env set).',
    )
  }
  const model = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash'
  const reduced = reduceHtml(html)

  const prompt = `You are given the cleaned HTML of a blog or listing page. Identify the CSS selectors needed to extract the list of recent articles.

Return ONLY a JSON object (no prose, no markdown fences) with these keys:
- "item": CSS selector matching each repeated article container element
- "title": CSS selector, relative to "item", for the article title text
- "link": CSS selector, relative to "item", for the <a> element linking to the article
- "date": optional CSS selector (relative to "item") for the publication date, or null
- "excerpt": optional CSS selector (relative to "item") for a short summary, or null

Prefer stable, generic selectors (semantic tags, common class names). The "item" selector must match multiple elements.

URL: ${listUrl}

HTML:
${reduced}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/air',
      'X-Title': 'air',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = json.choices?.[0]?.message?.content
  if (!content) return null
  const parsed = parseJsonLoose(content)
  if (!parsed || !parsed.item || !parsed.title || !parsed.link) return null
  return {
    item: String(parsed.item),
    title: String(parsed.title),
    link: String(parsed.link),
    date: parsed.date ? String(parsed.date) : undefined,
    excerpt: parsed.excerpt ? String(parsed.excerpt) : undefined,
  }
}

// --- shared helpers ---------------------------------------------------------

async function fetchText(url: string, kind: 'html' | 'feed'): Promise<string> {
  const accept =
    kind === 'feed'
      ? 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      : 'text/html,application/xhtml+xml,*/*'
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } })
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`)
  return res.text()
}

function reduceHtml(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, svg, noscript, head, link, meta, path, iframe').remove()
  const body = $('body').html() || $.root().html() || ''
  return body.replace(/\s+/g, ' ').slice(0, 12000)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonLoose(text: string): Record<string, any> | null {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

function dedupeByUrl(items: NormalizedItem[]): NormalizedItem[] {
  const seen = new Set<string>()
  const out: NormalizedItem[] = []
  for (const it of items) {
    if (!it.url || seen.has(it.url)) continue
    seen.add(it.url)
    out.push(it)
  }
  return out
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

function cleanExcerpt(html: string): string | undefined {
  if (!html) return undefined
  const text = decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 240) : undefined
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
