import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { v } from 'convex/values'
import { sourceType, websiteStrategy } from './schema'

export const list = query({
  args: { digestId: v.optional(v.id('digests')) },
  handler: async (ctx, { digestId }) => {
    if (digestId) {
      return await ctx.db
        .query('sources')
        .withIndex('by_digest_and_position', (q) => q.eq('digestId', digestId))
        .collect()
    }
    return await ctx.db.query('sources').withIndex('by_position').collect()
  },
})

// Curated, key-less sources that need no URL. Seeded (disabled) so they always
// show in the list for the user to toggle on.
const PRESETS: Array<{ type: 'producthunt' | 'hackernews' | 'devto'; name: string }> = [
  { type: 'producthunt', name: 'Product Hunt' },
  { type: 'hackernews', name: 'Hacker News' },
  { type: 'devto', name: 'dev.to' },
]

// Idempotently insert any missing curated preset (disabled). Called on page load.
export const ensureSeeded = mutation({
  args: { digestId: v.id('digests') },
  handler: async (ctx, { digestId }) => {
    const all = await ctx.db
      .query('sources')
      .withIndex('by_digest_and_position', (q) => q.eq('digestId', digestId))
      .collect()
    let pos = all.reduce((max, s) => Math.max(max, s.position), -1)
    for (const preset of PRESETS) {
      if (all.some((s) => s.type === preset.type && !s.url)) continue
      pos += 1
      await ctx.db.insert('sources', {
        digestId,
        type: preset.type,
        name: preset.name,
        enabled: false,
        position: pos,
      })
    }
  },
})

export const add = mutation({
  args: {
    digestId: v.id('digests'),
    type: sourceType,
    name: v.string(),
    url: v.optional(v.string()),
    config: v.optional(v.any()),
    preserveUrlParams: v.optional(v.boolean()), // whitelist this source from url cleaning
  },
  handler: async (ctx, args) => {
    const last = await ctx.db
      .query('sources')
      .withIndex('by_digest_and_position', (q) => q.eq('digestId', args.digestId))
      .order('desc')
      .first()
    return await ctx.db.insert('sources', {
      ...args,
      enabled: true,
      position: (last?.position ?? -1) + 1,
    })
  },
})

// Internal: load a single source (used by the refresh action).
export const get = internalQuery({
  args: { id: v.id('sources') },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  },
})

// Internal: cache the extraction recipe found for a website source.
export const setStrategy = internalMutation({
  args: { id: v.id('sources'), strategy: websiteStrategy },
  handler: async (ctx, { id, strategy }) => {
    await ctx.db.patch(id, { strategy })
  },
})

// Internal: flag a website source as needing a manual (LLM) scan, or clear it.
export const setNeedsManualScan = internalMutation({
  args: { id: v.id('sources'), value: v.boolean() },
  handler: async (ctx, { id, value }) => {
    await ctx.db.patch(id, { needsManualScan: value })
  },
})

export const setEnabled = mutation({
  args: { id: v.id('sources'), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => {
    await ctx.db.patch(id, { enabled })
  },
})

// Toggle whether a YouTube source includes Shorts.
export const setIncludeShorts = mutation({
  args: { id: v.id('sources'), value: v.boolean() },
  handler: async (ctx, { id, value }) => {
    await ctx.db.patch(id, { includeShorts: value })
  },
})

// Toggle whether a blog/site source shows article descriptions in the digest.
export const setShowDescription = mutation({
  args: { id: v.id('sources'), value: v.boolean() },
  handler: async (ctx, { id, value }) => {
    await ctx.db.patch(id, { showDescription: value })
  },
})

// Per-source cap on how many items the digest shows for this source.
export const setMaxItems = mutation({
  args: { id: v.id('sources'), value: v.number() },
  handler: async (ctx, { id, value }) => {
    await ctx.db.patch(id, { maxItems: Math.max(1, Math.round(value)) })
  },
})

// Per-source noise filters (layered on top of the digest-level ones). Empty
// arrays clear keyword filters; minScore = 0 disables the threshold.
export const setFilters = mutation({
  args: {
    id: v.id('sources'),
    includeKeywords: v.optional(v.array(v.string())),
    excludeKeywords: v.optional(v.array(v.string())),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch)
  },
})

// Per-source display options (layout, density, what to show, sort order).
export const setDisplay = mutation({
  args: {
    id: v.id('sources'),
    displayMode: v.optional(
      v.union(v.literal('title'), v.literal('excerpt'), v.literal('full')),
    ),
    layout: v.optional(
      v.union(v.literal('list'), v.literal('cards'), v.literal('grid')),
    ),
    density: v.optional(v.union(v.literal('comfortable'), v.literal('compact'))),
    showImage: v.optional(v.boolean()),
    showMeta: v.optional(v.boolean()),
    sortOrder: v.optional(
      v.union(v.literal('popular'), v.literal('recent'), v.literal('hybrid')),
    ),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch)
  },
})

// Persist a new display order (digest follows `position`).
export const reorder = mutation({
  args: { ids: v.array(v.id('sources')) },
  handler: async (ctx, { ids }) => {
    await Promise.all(ids.map((id, index) => ctx.db.patch(id, { position: index })))
  },
})

// Edit a source's type/name/url and reset everything derived from the old url
// (cached recipe, manual-scan flag, fetched items) so the next refresh rebuilds
// it from scratch.
export const edit = mutation({
  args: {
    id: v.id('sources'),
    type: sourceType,
    name: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, { id, type, name, url }) => {
    await ctx.db.patch(id, {
      type,
      name: name.trim(),
      url: url?.trim() || undefined,
      strategy: undefined,
      needsManualScan: undefined,
      lastFetchedAt: undefined,
    })
    const items = await ctx.db
      .query('items')
      .withIndex('by_source_published', (q) => q.eq('sourceId', id))
      .collect()
    for (const it of items) await ctx.db.delete(it._id)
  },
})

// Inline rename from the sources list.
export const rename = mutation({
  args: { id: v.id('sources'), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const trimmed = name.trim()
    if (trimmed) await ctx.db.patch(id, { name: trimmed })
  },
})

export const remove = mutation({
  args: { id: v.id('sources') },
  handler: async (ctx, { id }) => {
    const source = await ctx.db.get(id)
    if (!source) return null
    // Drop the source's cached items too, so nothing is orphaned.
    const items = await ctx.db
      .query('items')
      .withIndex('by_source_published', (q) => q.eq('sourceId', id))
      .collect()
    for (const it of items) await ctx.db.delete(it._id)
    await ctx.db.delete(id)
    // Restorable snapshot (no system fields) for the toast's Undo action.
    return {
      digestId: source.digestId,
      type: source.type,
      name: source.name,
      url: source.url,
      config: source.config,
      enabled: source.enabled,
      position: source.position,
      iconUrl: source.iconUrl,
      preserveUrlParams: source.preserveUrlParams,
      strategy: source.strategy,
      needsManualScan: source.needsManualScan,
      includeShorts: source.includeShorts,
      showDescription: source.showDescription,
      maxItems: source.maxItems,
      includeKeywords: source.includeKeywords,
      excludeKeywords: source.excludeKeywords,
      minScore: source.minScore,
      displayMode: source.displayMode,
      layout: source.layout,
      density: source.density,
      showImage: source.showImage,
      showMeta: source.showMeta,
      sortOrder: source.sortOrder,
      lastFetchedAt: source.lastFetchedAt,
    }
  },
})

// Re-insert a source removed by mistake (Undo).
export const restore = mutation({
  args: {
    digestId: v.optional(v.id('digests')),
    type: sourceType,
    name: v.string(),
    url: v.optional(v.string()),
    config: v.optional(v.any()),
    enabled: v.boolean(),
    position: v.number(),
    iconUrl: v.optional(v.string()),
    preserveUrlParams: v.optional(v.boolean()),
    strategy: v.optional(websiteStrategy),
    needsManualScan: v.optional(v.boolean()),
    includeShorts: v.optional(v.boolean()),
    showDescription: v.optional(v.boolean()),
    maxItems: v.optional(v.number()),
    includeKeywords: v.optional(v.array(v.string())),
    excludeKeywords: v.optional(v.array(v.string())),
    minScore: v.optional(v.number()),
    displayMode: v.optional(
      v.union(v.literal('title'), v.literal('excerpt'), v.literal('full')),
    ),
    layout: v.optional(
      v.union(v.literal('list'), v.literal('cards'), v.literal('grid')),
    ),
    density: v.optional(v.union(v.literal('comfortable'), v.literal('compact'))),
    showImage: v.optional(v.boolean()),
    showMeta: v.optional(v.boolean()),
    sortOrder: v.optional(
      v.union(v.literal('popular'), v.literal('recent'), v.literal('hybrid')),
    ),
    lastFetchedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('sources', args)
  },
})
