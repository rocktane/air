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

// Send cadence for a digest's scheduled email.
export const digestSchedule = v.union(
  v.literal('daily'),
  v.literal('weekly'),
  v.literal('off'),
)

// Snapshot of one item inside an archived edition (display fields only).
export const editionItem = v.object({
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

export const editionSection = v.object({
  sourceName: v.string(),
  sourceType,
  items: v.array(editionItem),
})

export default defineSchema({
  // A "brew": an independent digest with its own sources, schedule and filters.
  digests: defineTable({
    name: v.string(),
    enabled: v.boolean(),
    position: v.number(),
    // Scheduled email delivery (feature: Brevo + cron).
    schedule: digestSchedule,
    timezone: v.string(), // IANA tz, e.g. 'Europe/Paris'
    sendHour: v.optional(v.number()), // 0-23 local hour to send (default 8)
    weekday: v.optional(v.number()), // 0=Sun…6=Sat, used when schedule = weekly
    emailTo: v.optional(v.string()),
    lastSentAt: v.optional(v.number()), // epoch ms of last successful send
    // Noise filters applied to every source in this digest.
    includeKeywords: v.optional(v.array(v.string())),
    excludeKeywords: v.optional(v.array(v.string())),
    minScore: v.optional(v.number()),
    dedupe: v.optional(v.boolean()), // drop the same link appearing in 2+ sources
  }).index('by_position', ['position']),

  // One row per configured source.
  sources: defineTable({
    digestId: v.optional(v.id('digests')), // owning digest (backfilled on migration)
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
    // Per-source noise filters (layered on top of the digest-level ones).
    includeKeywords: v.optional(v.array(v.string())),
    excludeKeywords: v.optional(v.array(v.string())),
    minScore: v.optional(v.number()),
    // Display options (improvements 1-3).
    displayMode: v.optional(
      v.union(v.literal('title'), v.literal('excerpt'), v.literal('full')),
    ), // blogs/sites: title only / excerpt / full article inline
    layout: v.optional(
      v.union(v.literal('list'), v.literal('cards'), v.literal('grid')),
    ),
    density: v.optional(v.union(v.literal('comfortable'), v.literal('compact'))),
    showImage: v.optional(v.boolean()),
    showMeta: v.optional(v.boolean()),
    sortOrder: v.optional(
      v.union(v.literal('popular'), v.literal('recent'), v.literal('hybrid')),
    ),
  })
    .index('by_position', ['position'])
    .index('by_digest_and_position', ['digestId', 'position']),

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

  // Frozen snapshot of a digest at publish time — browsable archive + public
  // share. Written once, never grows, so the nested arrays stay bounded.
  editions: defineTable({
    digestId: v.id('digests'),
    digestName: v.string(), // denormalized: edition survives a rename/delete
    slug: v.string(), // unguessable public share token
    createdAt: v.number(),
    sections: v.array(editionSection),
  })
    .index('by_digest_and_createdAt', ['digestId', 'createdAt'])
    .index('by_slug', ['slug']),

  // Single-user global settings for the POC.
  settings: defineTable({
    schedule: v.union(v.literal('daily'), v.literal('weekly')),
    timezone: v.string(),
    maxItemsPerSource: v.number(),
  }),
})
