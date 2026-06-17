'use node'

import { action } from './_generated/server'
import { v } from 'convex/values'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import * as cheerio from 'cheerio'

const UA = 'air/0.1 (personal newsletter reader)'

// Fetch an article and extract a clean "reader mode" version (Readability).
export const read = action({
  args: { url: v.string() },
  handler: async (_ctx, { url }) => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'fr,en;q=0.8',
      },
    })
    if (!res.ok) throw new Error(`Impossible de charger l'article (HTTP ${res.status})`)
    const html = await res.text()

    const { document } = parseHTML(html)
    const article = new Readability(document as unknown as Document).parse()
    if (!article?.content) {
      throw new Error("Impossible d'extraire le contenu de cet article.")
    }

    return {
      title: article.title ?? '',
      byline: article.byline ?? undefined,
      siteName: article.siteName ?? undefined,
      excerpt: article.excerpt ?? undefined,
      content: sanitize(article.content, url),
    }
  },
})

// Strip anything executable, absolutize links/images, open links in a new tab.
function sanitize(html: string, baseUrl: string): string {
  const $ = cheerio.load(html, null, false)
  $('script, style, iframe, object, embed, link, meta, noscript, form, input, button').remove()

  $('*').each((_, el) => {
    if (el.type !== 'tag') return
    for (const name of Object.keys(el.attribs)) {
      const value = el.attribs[name]
      if (/^on/i.test(name)) {
        delete el.attribs[name]
        continue
      }
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) {
        delete el.attribs[name]
        continue
      }
      if ((name === 'href' || name === 'src' || name === 'srcset') && value) {
        try {
          if (name !== 'srcset') el.attribs[name] = new URL(value, baseUrl).href
        } catch {
          /* leave as-is */
        }
      }
    }
    if (el.name === 'a') {
      el.attribs.target = '_blank'
      el.attribs.rel = 'noreferrer'
    }
  })

  return $.html()
}
