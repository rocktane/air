import { query } from './_generated/server'
import { DEFAULT_MAX_ITEMS } from './settings'

// Sources whose items are ranked by score (votes / points / reactions) rather
// than recency. Everything else (feeds, sites, YouTube) ranks by recency.
const SCORE_RANKED = new Set(['producthunt', 'hackernews', 'devto', 'subreddit'])

// YouTube caps: the RSS feed only exposes the latest 15 uploads (few long-form
// once Shorts are filtered), and the digest lays videos out two per row — so we
// offer just 2 or 4.
const YOUTUBE_DEFAULT_MAX = 4
const YOUTUBE_HARD_MAX = 4

// Builds the digest on the fly: every enabled source with its top items. The
// dashboard subscribes to this query for live updates. Each source caps its
// items with its own `maxItems` (falling back to the global default); YouTube
// is forced to an even count so the 2-per-row grid never leaves a gap.
export const latest = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query('settings').first()
    const fallback = settings?.maxItemsPerSource ?? DEFAULT_MAX_ITEMS

    const sources = await ctx.db.query('sources').withIndex('by_position').collect()

    const sections = await Promise.all(
      sources
        .filter((source) => source.enabled)
        .map(async (source) => {
          let limit = source.maxItems ?? (source.type === 'youtube' ? YOUTUBE_DEFAULT_MAX : fallback)
          if (source.type === 'youtube') {
            limit = Math.min(limit, YOUTUBE_HARD_MAX)
            if (limit % 2 === 1) limit = Math.max(2, limit - 1) // keep the 2-per-row grid even
          }

          const items = SCORE_RANKED.has(source.type)
            ? await ctx.db
                .query('items')
                .withIndex('by_source_score', (q) => q.eq('sourceId', source._id))
                .order('desc')
                .take(limit)
            : await ctx.db
                .query('items')
                .withIndex('by_source_published', (q) => q.eq('sourceId', source._id))
                .order('desc')
                .take(limit)
          return { source, items }
        }),
    )

    return sections
  },
})
