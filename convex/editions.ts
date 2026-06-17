import { action, internalMutation, mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { api, internal } from './_generated/api'
import { editionSection } from './schema'
import type { Doc } from './_generated/dataModel'

type LatestSection = { source: Doc<'sources'>; items: Doc<'items'>[] }

// Map a live digest (digest.latest output) into the frozen edition snapshot.
export function toEditionSections(sections: LatestSection[]) {
  return sections.map((s) => ({
    sourceName: s.source.name,
    sourceType: s.source.type,
    items: s.items.map((it) => ({
      title: it.title,
      url: it.url,
      author: it.author,
      publishedAt: it.publishedAt,
      score: it.score,
      commentsCount: it.commentsCount,
      excerpt: it.excerpt,
      imageUrl: it.imageUrl,
      websiteUrl: it.websiteUrl,
    })),
  }))
}

// Recent editions of one digest (newest first).
export const list = query({
  args: { digestId: v.optional(v.id('digests')) },
  handler: async (ctx, { digestId }) => {
    if (!digestId) return []
    return await ctx.db
      .query('editions')
      .withIndex('by_digest_and_createdAt', (q) => q.eq('digestId', digestId))
      .order('desc')
      .take(50)
  },
})

// Public read of a single edition by its share token (no auth).
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query('editions')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
  },
})

// Persist a snapshot (called by the cron/test send and by archiveNow).
export const create = internalMutation({
  args: {
    digestId: v.id('digests'),
    digestName: v.string(),
    slug: v.string(),
    createdAt: v.number(),
    sections: v.array(editionSection),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('editions', args)
  },
})

export const remove = mutation({
  args: { id: v.id('editions') },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
  },
})

// Snapshot the current state of a digest into a new edition, without sending an
// email. Returns the new edition's public slug.
export const archiveNow = action({
  args: { digestId: v.id('digests') },
  handler: async (ctx, { digestId }): Promise<{ slug: string }> => {
    const digest = await ctx.runQuery(api.digests.get, { id: digestId })
    if (!digest) throw new Error('Digest introuvable')
    const sections: LatestSection[] = await ctx.runQuery(api.digest.latest, { digestId })
    const filled = sections.filter((s) => s.items.length > 0)
    const slug = crypto.randomUUID().replace(/-/g, '')
    await ctx.runMutation(internal.editions.create, {
      digestId,
      digestName: digest.name,
      slug,
      createdAt: Date.now(),
      sections: toEditionSections(filled),
    })
    return { slug }
  },
})
