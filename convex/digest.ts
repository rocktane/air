import { query } from './_generated/server'
import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { DEFAULT_MAX_ITEMS } from './settings'
import { dedupeKey, keepItem } from './filtering'

// Sources whose items are ranked by score (votes / points / reactions) rather
// than recency. Everything else (feeds, sites, YouTube) ranks by recency.
const SCORE_RANKED = new Set(['producthunt', 'hackernews', 'devto', 'subreddit'])

// YouTube caps: the RSS feed only exposes the latest 15 uploads (few long-form
// once Shorts are filtered), and the digest lays videos out two per row — so we
// offer just 2 or 4.
const YOUTUBE_DEFAULT_MAX = 4
const YOUTUBE_HARD_MAX = 4

// Builds a digest on the fly: every enabled source (of the target digest) with
// its top items, after applying the digest's keyword/score filters and an
// optional cross-source dedup. The dashboard subscribes to this query for live
// updates.
export const latest = query({
  args: { digestId: v.optional(v.id('digests')) },
  handler: async (ctx, { digestId }) => {
    const settings = await ctx.db.query('settings').first()
    const fallback = settings?.maxItemsPerSource ?? DEFAULT_MAX_ITEMS

    // Target digest: explicit id, else the first one (migration / single digest).
    const digest = digestId
      ? await ctx.db.get(digestId)
      : await ctx.db.query('digests').withIndex('by_position').first()

    const sources = digest
      ? await ctx.db
          .query('sources')
          .withIndex('by_digest_and_position', (q) => q.eq('digestId', digest._id))
          .collect()
      : await ctx.db.query('sources').withIndex('by_position').collect()

    const dedupe = digest?.dedupe ?? false
    const seen = new Set<string>() // cross-source dedup within this digest

    const sections: { source: Doc<'sources'>; items: Doc<'items'>[] }[] = []
    for (const source of sources) {
      if (!source.enabled) continue

      let limit = source.maxItems ?? (source.type === 'youtube' ? YOUTUBE_DEFAULT_MAX : fallback)
      if (source.type === 'youtube') {
        limit = Math.min(limit, YOUTUBE_HARD_MAX)
        if (limit % 2 === 1) limit = Math.max(2, limit - 1) // keep the 2-per-row grid even
      }

      // Ranking: explicit per-source sortOrder, else score for score-ranked
      // source types and recency for the rest. Over-fetch so filtering/dedup
      // still leaves us close to `limit`.
      const sortOrder =
        source.sortOrder ?? (SCORE_RANKED.has(source.type) ? 'popular' : 'recent')
      const headroom = limit + 8
      let raw: Doc<'items'>[]
      if (sortOrder === 'popular') {
        raw = await ctx.db
          .query('items')
          .withIndex('by_source_score', (q) => q.eq('sourceId', source._id))
          .order('desc')
          .take(headroom)
      } else if (sortOrder === 'hybrid') {
        // Most-popular within the recent window.
        const recent = await ctx.db
          .query('items')
          .withIndex('by_source_published', (q) => q.eq('sourceId', source._id))
          .order('desc')
          .take(Math.max(headroom * 2, 24))
        raw = recent.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      } else {
        raw = await ctx.db
          .query('items')
          .withIndex('by_source_published', (q) => q.eq('sourceId', source._id))
          .order('desc')
          .take(headroom)
      }

      const items: Doc<'items'>[] = []
      for (const it of raw) {
        if (!keepItem(it, digest ?? {}, source)) continue
        if (dedupe) {
          const key = dedupeKey(it.url)
          if (seen.has(key)) continue
          seen.add(key)
        }
        items.push(it)
        if (items.length >= limit) break
      }
      sections.push({ source, items })
    }

    return sections
  },
})
