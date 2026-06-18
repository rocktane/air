import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

// Global default applied until the user picks their own value.
export const DEFAULT_MAX_ITEMS = 5

// The POC is single-user, so settings live in (at most) one row.
export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('settings').first()
    return {
      schedule: row?.schedule ?? ('daily' as const),
      timezone: row?.timezone ?? 'Europe/Paris',
      maxItemsPerSource: row?.maxItemsPerSource ?? DEFAULT_MAX_ITEMS,
      openLinksInBackground: row?.openLinksInBackground ?? false,
      weatherEnabled: row?.weatherEnabled ?? false,
      weatherCities: row?.weatherCities ?? [],
    }
  },
})

export const update = mutation({
  args: {
    schedule: v.optional(v.union(v.literal('daily'), v.literal('weekly'))),
    timezone: v.optional(v.string()),
    maxItemsPerSource: v.optional(v.number()),
    openLinksInBackground: v.optional(v.boolean()),
    weatherEnabled: v.optional(v.boolean()),
    weatherCities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('settings').first()
    if (existing) {
      await ctx.db.patch(existing._id, args)
      return
    }
    await ctx.db.insert('settings', {
      schedule: args.schedule ?? 'daily',
      timezone: args.timezone ?? 'Europe/Paris',
      maxItemsPerSource: args.maxItemsPerSource ?? DEFAULT_MAX_ITEMS,
      openLinksInBackground: args.openLinksInBackground ?? false,
      weatherEnabled: args.weatherEnabled,
      weatherCities: args.weatherCities,
    })
  },
})
