import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

// Upper bound on read marks loaded by the dashboard. The POC is single-user and
// only ever displays a handful of items, so this is comfortably above what the
// UI needs while keeping the query bounded.
const MAX = 5000

// Read urls, as a flat list. The dashboard turns this into a Set to grey out
// already-seen items.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('reads').take(MAX)
    return rows.map((r) => r.url)
  },
})

// Mark a link as read (idempotent). Called when a digest link is opened.
export const markRead = mutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const existing = await ctx.db
      .query('reads')
      .withIndex('by_url', (q) => q.eq('url', url))
      .unique()
    if (existing) return
    await ctx.db.insert('reads', { url, readAt: Date.now() })
  },
})

// Flip the read state of a link (manual dot toggle). Returns the new state.
export const toggle = mutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const existing = await ctx.db
      .query('reads')
      .withIndex('by_url', (q) => q.eq('url', url))
      .unique()
    if (existing) {
      await ctx.db.delete(existing._id)
      return false
    }
    await ctx.db.insert('reads', { url, readAt: Date.now() })
    return true
  },
})
