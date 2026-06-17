import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// Source types supported by the POC. Extend with 'subreddit' | ...
export const sourceType = v.union(
  v.literal('producthunt'),
  v.literal('rss'),
  v.literal('website'),
  v.literal('youtube'),
  v.literal('hackernews'),
  v.literal('devto'),
  v.literal('subreddit'),
)

// Cached extraction "recipe" for a website without RSS, found once by the
// cascade (analyzeWebsite) and replayed cheaply on every refresh.
export const websiteStrategy = v.union(
  v.object({ kind: v.literal('feed'), url: v.string() }),
  v.object({ kind: v.literal('wpApi'), base: v.string() }),
  v.object({ kind: v.literal('jsonld'), listUrl: v.string() }),
  v.object({
    kind: v.literal('selectors'),
    listUrl: v.string(),
    item: v.string(),
    title: v.string(),
    link: v.string(),
    date: v.optional(v.string()),
    excerpt: v.optional(v.string()),
  }),
)

export default defineSchema({
  // One row per configured source.
  sources: defineTable({
    type: sourceType,
    name: v.string(),
    url: v.optional(v.string()), // feed/page url, or topic for producthunt
    config: v.optional(v.any()), // type-specific extra config
    enabled: v.boolean(),
    position: v.number(), // display order
    lastFetchedAt: v.optional(v.number()),
    iconUrl: v.optional(v.string()),
    strategy: v.optional(websiteStrategy), // cached extraction recipe (website sources)
    preserveUrlParams: v.optional(v.boolean()), // whitelist: keep item urls' query string as-is
    needsManualScan: v.optional(v.boolean()), // website: free tiers failed, awaiting LLM scan
    includeShorts: v.optional(v.boolean()), // youtube: include Shorts in the digest (default true)
    showDescription: v.optional(v.boolean()), // blogs/sites: show article excerpt (default true)
    maxItems: v.optional(v.number()), // per-source item cap shown in the digest
  }).index('by_position', ['position']),

  // Normalized content items collected from sources.
  items: defineTable({
    sourceId: v.id('sources'),
    externalId: v.string(), // dedup key (url or external id)
    title: v.string(),
    url: v.string(),
    author: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    score: v.optional(v.number()), // votes / points
    commentsCount: v.optional(v.number()),
    excerpt: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    websiteUrl: v.optional(v.string()), // official product/site link (e.g. Product Hunt)
    fetchedAt: v.number(),
  })
    .index('by_source_external', ['sourceId', 'externalId'])
    .index('by_source_published', ['sourceId', 'publishedAt'])
    .index('by_source_score', ['sourceId', 'score']),

  // Single-user settings for the POC.
  settings: defineTable({
    schedule: v.union(v.literal('daily'), v.literal('weekly')),
    timezone: v.string(),
    maxItemsPerSource: v.number(),
  }),
})
