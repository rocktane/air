'use node'

import { action, internalAction } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { api, internal } from './_generated/api'
import { v } from 'convex/values'
import type { Doc } from './_generated/dataModel'
import { toEditionSections } from './editions'

type Section = { source: Doc<'sources'>; items: Doc<'items'>[] }

const DEFAULT_TO = 'digest@23o.dev'
const DEFAULT_TZ = 'Europe/Paris'

// --- Cron entry point -------------------------------------------------------

// Runs hourly. Sends every enabled digest whose local send time has arrived and
// that hasn't already gone out today (idempotent via lastSentAt).
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const digests = await ctx.runQuery(api.digests.list, {})
    const sent: string[] = []
    for (const d of digests) {
      if (!d.enabled || !isDue(d, now)) continue
      try {
        await deliver(ctx, d._id, now)
        sent.push(d.name)
      } catch (e) {
        console.error(`[air] envoi du digest « ${d.name} » échoué:`, e)
      }
    }
    return { sent }
  },
})

// Manual "send now" for a single digest (test button in Réglages). Ignores the
// schedule; refreshes, renders and sends immediately.
export const sendNow = action({
  args: { digestId: v.id('digests') },
  handler: async (ctx, { digestId }): Promise<{ ok: true }> => {
    await deliver(ctx, digestId, Date.now())
    return { ok: true }
  },
})

// Refresh the digest's sources, render the email and send it via Brevo.
async function deliver(
  ctx: ActionCtx,
  digestId: Doc<'digests'>['_id'],
  now: number,
): Promise<void> {
  const digest = await ctx.runQuery(api.digests.get, { id: digestId })
  if (!digest) throw new Error('Digest introuvable')

  await ctx.runAction(internal.fetchers.refreshDigest, { digestId })
  const sections: Section[] = await ctx.runQuery(api.digest.latest, { digestId })
  const filled = sections.filter((s) => s.items.length > 0)

  const html = renderEmail(digest, filled)
  await sendBrevo({
    to: digest.emailTo || DEFAULT_TO,
    subject: subjectFor(digest, now),
    html,
  })
  await ctx.runMutation(internal.digests.markSent, { id: digestId, at: now })

  // Archive this edition (browsable + shareable).
  await ctx.runMutation(internal.editions.create, {
    digestId,
    digestName: digest.name,
    slug: crypto.randomUUID().replace(/-/g, ''),
    createdAt: now,
    sections: toEditionSections(filled),
  })
}

// --- Scheduling -------------------------------------------------------------

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

// Local calendar parts for a timestamp in the given IANA timezone.
function localParts(tz: string, at: number): { dateKey: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(at))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hour: parseInt(get('hour'), 10) % 24, // '24' (midnight) → 0
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  }
}

function isDue(digest: Doc<'digests'>, now: number): boolean {
  if (digest.schedule === 'off') return false
  const tz = digest.timezone || DEFAULT_TZ
  const { dateKey, hour, weekday } = localParts(tz, now)
  if (hour !== (digest.sendHour ?? 8)) return false
  if (digest.schedule === 'weekly' && weekday !== (digest.weekday ?? 1)) return false
  // Already sent during this local day? (cron runs hourly — guard duplicates.)
  if (digest.lastSentAt && localParts(tz, digest.lastSentAt).dateKey === dateKey) return false
  return true
}

// --- Brevo ------------------------------------------------------------------

async function sendBrevo({ to, subject, html }: { to: string; subject: string; html: string }) {
  const key = process.env.BREVO_API_KEY
  if (!key) throw new Error('BREVO_API_KEY manquant (convex env set BREVO_API_KEY …)')
  const sender = process.env.BREVO_SENDER || to
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': key,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: sender, name: process.env.BREVO_SENDER_NAME || 'air' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  })
  if (!res.ok) {
    throw new Error(`Brevo HTTP ${res.status}: ${await res.text()}`)
  }
}

// --- HTML rendering ---------------------------------------------------------

function subjectFor(digest: Doc<'digests'>, now: number): string {
  const date = new Intl.DateTimeFormat('fr-FR', {
    timeZone: digest.timezone || DEFAULT_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(now))
  return `${digest.name} · ${date}`
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderEmail(digest: Doc<'digests'>, sections: Section[]): string {
  const blocks = sections
    .map((section) => {
      const rows = section.items
        .map((item) => {
          const meta: string[] = []
          if (item.score != null) meta.push(`▲ ${item.score}`)
          if (item.commentsCount != null) meta.push(`💬 ${item.commentsCount}`)
          if (item.author) meta.push(esc(item.author))
          if (item.publishedAt) {
            meta.push(
              new Intl.DateTimeFormat('fr-FR', {
                timeZone: digest.timezone || DEFAULT_TZ,
              }).format(new Date(item.publishedAt)),
            )
          }
          const metaLine = meta.length
            ? `<div style="font-size:12px;color:#888;margin-top:2px">${esc(meta.join(' · '))}</div>`
            : ''
          const excerpt =
            item.excerpt && (section.source.showDescription ?? true)
              ? `<div style="font-size:13px;color:#555;margin-top:3px">${esc(item.excerpt)}</div>`
              : ''
          return `
            <li style="margin:0 0 14px">
              <a href="${esc(item.url)}" style="font-size:15px;font-weight:600;color:#111;text-decoration:none">${esc(item.title)}</a>
              ${metaLine}
              ${excerpt}
            </li>`
        })
        .join('')
      return `
        <section style="margin:0 0 28px">
          <h2 style="font-size:16px;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #eee">${esc(section.source.name)}</h2>
          <ul style="list-style:none;margin:0;padding:0">${rows}</ul>
        </section>`
    })
    .join('')

  const body = blocks || '<p style="color:#888">Aucun contenu pour ce digest.</p>'
  return `<!doctype html><html><body style="margin:0;background:#fff">
    <div style="max-width:640px;margin:0 auto;padding:28px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
      <h1 style="font-size:22px;margin:0 0 4px">${esc(digest.name)}</h1>
      <p style="font-size:13px;color:#888;margin:0 0 24px">${esc(subjectForDateOnly(digest))}</p>
      ${body}
      <p style="font-size:11px;color:#aaa;margin-top:32px;border-top:1px solid #eee;padding-top:12px">Envoyé par air</p>
    </div>
  </body></html>`
}

function subjectForDateOnly(digest: Doc<'digests'>): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: digest.timezone || DEFAULT_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())
}
