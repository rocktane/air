import { internalMutation, mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { digestSchedule } from './schema'

const DEFAULT_EMAIL = 'digest@23o.dev'
const DEFAULT_TZ = 'Europe/Paris'

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query('digests').withIndex('by_position').collect(),
})

export const get = query({
  args: { id: v.id('digests') },
  handler: async (ctx, { id }) => ctx.db.get(id),
})

// Idempotent migration: create the first digest if none exists, then assign any
// source that has no digest yet to it. Returns the default/first digest id.
export const ensureDefault = mutation({
  args: {},
  handler: async (ctx) => {
    let first = await ctx.db.query('digests').withIndex('by_position').first()
    if (!first) {
      const settings = await ctx.db.query('settings').first()
      const id = await ctx.db.insert('digests', {
        name: 'Mon digest',
        enabled: true,
        position: 0,
        schedule: settings?.schedule ?? 'daily',
        timezone: settings?.timezone ?? DEFAULT_TZ,
        sendHour: 8,
        weekday: 1,
        emailTo: DEFAULT_EMAIL,
        dedupe: true,
      })
      first = await ctx.db.get(id)
    }
    const orphans = await ctx.db
      .query('sources')
      .withIndex('by_digest_and_position', (q) => q.eq('digestId', undefined))
      .collect()
    for (const s of orphans) {
      await ctx.db.patch(s._id, { digestId: first!._id })
    }
    return first!._id
  },
})

export const create = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    const last = await ctx.db
      .query('digests')
      .withIndex('by_position')
      .order('desc')
      .first()
    return ctx.db.insert('digests', {
      name: name?.trim() || 'Nouveau digest',
      enabled: true,
      position: (last?.position ?? -1) + 1,
      schedule: 'off',
      timezone: DEFAULT_TZ,
      sendHour: 8,
      weekday: 1,
      emailTo: DEFAULT_EMAIL,
      dedupe: true,
    })
  },
})

export const rename = mutation({
  args: { id: v.id('digests'), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const trimmed = name.trim()
    if (trimmed) await ctx.db.patch(id, { name: trimmed })
  },
})

// Scheduling + delivery settings for one digest.
export const updateSchedule = mutation({
  args: {
    id: v.id('digests'),
    schedule: v.optional(digestSchedule),
    timezone: v.optional(v.string()),
    sendHour: v.optional(v.number()),
    weekday: v.optional(v.number()),
    emailTo: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch)
  },
})

// Noise filters + cross-source dedup for one digest. Empty arrays clear the
// keyword filters; minScore = 0 disables the score threshold.
export const updateFilters = mutation({
  args: {
    id: v.id('digests'),
    includeKeywords: v.optional(v.array(v.string())),
    excludeKeywords: v.optional(v.array(v.string())),
    minScore: v.optional(v.number()),
    dedupe: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, patch)
  },
})

// Record the time a digest's email was sent (cron / test send).
export const markSent = internalMutation({
  args: { id: v.id('digests'), at: v.number() },
  handler: async (ctx, { id, at }) => {
    await ctx.db.patch(id, { lastSentAt: at })
  },
})

export const remove = mutation({
  args: { id: v.id('digests') },
  handler: async (ctx, { id }) => {
    const sources = await ctx.db
      .query('sources')
      .withIndex('by_digest_and_position', (q) => q.eq('digestId', id))
      .collect()
    for (const s of sources) {
      const items = await ctx.db
        .query('items')
        .withIndex('by_source_published', (q) => q.eq('sourceId', s._id))
        .collect()
      for (const it of items) await ctx.db.delete(it._id)
      await ctx.db.delete(s._id)
    }
    await ctx.db.delete(id)
  },
})

// Duplicate a digest with its sources (fresh: no cached items or recipes).
export const clone = mutation({
  args: { id: v.id('digests') },
  handler: async (ctx, { id }) => {
    const src = await ctx.db.get(id)
    if (!src) return null
    const last = await ctx.db
      .query('digests')
      .withIndex('by_position')
      .order('desc')
      .first()
    const { _id, _creationTime, name, position, lastSentAt, ...rest } = src
    void _id
    void _creationTime
    void position
    void lastSentAt
    const newId = await ctx.db.insert('digests', {
      ...rest,
      name: `${name} (copie)`,
      position: (last?.position ?? -1) + 1,
    })

    const sources = await ctx.db
      .query('sources')
      .withIndex('by_digest_and_position', (q) => q.eq('digestId', id))
      .collect()
    for (const s of sources) {
      const {
        _id: sId,
        _creationTime: sCt,
        digestId,
        lastFetchedAt,
        strategy,
        needsManualScan,
        ...srest
      } = s
      void sId
      void sCt
      void digestId
      void lastFetchedAt
      void strategy
      void needsManualScan
      await ctx.db.insert('sources', { ...srest, digestId: newId })
    }
    return newId
  },
})
