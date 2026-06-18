import { action } from './_generated/server'
import { api } from './_generated/api'
import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'

// Stable fallback model. For "DeepSeek V4 Pro" (or any other model), set the
// exact slug from https://openrouter.ai/models via:
//   npx convex env set OPENROUTER_MODEL deepseek/<slug>
const DEFAULT_MODEL = 'deepseek/deepseek-chat'

// Cap how many items we feed the model so the prompt stays bounded and cheap.
const MAX_ITEMS = 60
const EXCERPT_LEN = 220

type Section = { source: Doc<'sources'>; items: Doc<'items'>[] }

// Generate an on-demand LLM summary of the digest's current items, optionally
// focused on a single topic. Uses OpenRouter (OpenAI-compatible chat API).
export const generate = action({
  args: { digestId: v.optional(v.id('digests')), topic: v.optional(v.string()) },
  handler: async (ctx, { digestId, topic }): Promise<{ summary: string }> => {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) {
      throw new Error('OPENROUTER_API_KEY manquant (npx convex env set OPENROUTER_API_KEY …)')
    }
    const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL

    const sections: Section[] = await ctx.runQuery(api.digest.latest, { digestId })
    const filled = sections.filter((s) => s.items.length > 0)
    if (filled.length === 0) {
      throw new Error('Aucun contenu à résumer — rafraîchis le digest d’abord.')
    }

    const corpus = buildCorpus(filled)
    const cleanTopic = topic?.trim()

    const system = [
      "Tu es l'assistant de veille de l'utilisateur. À partir de la liste d'articles",
      'ci-dessous (issus de ses propres sources), rédige en français un résumé clair et',
      "actionnable de l'actualité du jour. Regroupe par thèmes, mets en avant les 3 à 6",
      "informations les plus importantes, reste concis et factuel, et n'invente jamais",
      "d'information absente de la liste. Format markdown léger : courts intertitres en gras",
      '(**…**) et puces (- …).',
      cleanTopic
        ? `Concentre-toi UNIQUEMENT sur le sujet « ${cleanTopic} » : ignore tout le reste. Si aucun article ne concerne ce sujet, dis-le clairement en une phrase.`
        : '',
    ]
      .filter(Boolean)
      .join(' ')

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'air',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Articles du jour :\n\n${corpus}` },
        ],
      }),
    })
    if (!res.ok) {
      throw new Error(`OpenRouter HTTP ${res.status} : ${await res.text()}`)
    }
    const data = await res.json()
    const summary: string | undefined = data?.choices?.[0]?.message?.content?.trim()
    if (!summary) throw new Error('Réponse vide du modèle.')
    return { summary }
  },
})

// Flatten the digest into a compact, source-grouped text block, capped so the
// prompt stays bounded.
function buildCorpus(sections: Section[]): string {
  const lines: string[] = []
  let count = 0
  for (const { source, items } of sections) {
    if (count >= MAX_ITEMS) break
    lines.push(`## ${source.name}`)
    for (const it of items) {
      if (count >= MAX_ITEMS) break
      const bits = [it.title]
      if (it.excerpt) bits.push(truncate(it.excerpt, EXCERPT_LEN))
      lines.push(`- ${bits.join(' — ')} (${it.url})`)
      count += 1
    }
  }
  return lines.join('\n')
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
