import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

// Shape of a normalized item produced by a fetcher (before storage fields).
export const itemInput = v.object({
  externalId: v.string(),
  title: v.string(),
  url: v.string(),
  author: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
  score: v.optional(v.number()),
  commentsCount: v.optional(v.number()),
  excerpt: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  websiteUrl: v.optional(v.string()),
})

// Insert new items, patch existing ones (dedup by sourceId + externalId).
export const upsertMany = internalMutation({
  args: { sourceId: v.id('sources'), items: v.array(itemInput) },
  handler: async (ctx, { sourceId, items }) => {
    const now = Date.now()
    let inserted = 0
    for (const item of items) {
      const existing = await ctx.db
        .query('items')
        .withIndex('by_source_external', (q) =>
          q.eq('sourceId', sourceId).eq('externalId', item.externalId),
        )
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, { ...item, fetchedAt: now })
      } else {
        await ctx.db.insert('items', { ...item, sourceId, fetchedAt: now })
        inserted += 1
      }
    }
    await ctx.db.patch(sourceId, { lastFetchedAt: now })
    return { total: items.length, inserted }
  },
})

// Delete a source's stored Shorts (links under /shorts/). Used when a YouTube
// source has Shorts turned off, so previously-cached Shorts disappear too.
export const pruneShorts = internalMutation({
  args: { sourceId: v.id('sources') },
  handler: async (ctx, { sourceId }) => {
    const rows = await ctx.db
      .query('items')
      .withIndex('by_source_published', (q) => q.eq('sourceId', sourceId))
      .collect()
    let deleted = 0
    for (const row of rows) {
      if (row.url.includes('/shorts/')) {
        await ctx.db.delete(row._id)
        deleted += 1
      }
    }
    return deleted
  },
})

// Wipe the items cache, one bounded batch per transaction. Self-schedules until
// the table is empty so it stays within Convex's per-mutation write limits.
export const clearAll = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const batch = await ctx.db.query('items').take(500)
    for (const row of batch) {
      await ctx.db.delete(row._id)
    }
    if (batch.length === 500) {
      await ctx.scheduler.runAfter(0, internal.items.clearAll, {})
    }
    return { deleted: batch.length }
  },
})
