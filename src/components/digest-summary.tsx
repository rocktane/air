import { useState, type ReactNode } from 'react'
import { useAction } from 'convex/react'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// On-demand AI summary of the active digest's items (OpenRouter). Optional topic
// narrows the synthesis to a single subject.
export function DigestSummary({ digestId }: { digestId?: Id<'digests'> }) {
  const generate = useAction(api.summary.generate)
  const [topic, setTopic] = useState('')
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function run() {
    if (loading) return
    setLoading(true)
    try {
      const res = await generate({ digestId, topic: topic.trim() || undefined })
      setSummary(res.summary)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec du résumé')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-lg border bg-card/50 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Résumé intelligent</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Synthèse de ta veille du jour, générée par IA à partir de tes sources.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run()
          }}
          placeholder="Sujet précis (optionnel) — ex. « IA », « React »"
          className="sm:flex-1"
        />
        <Button onClick={run} disabled={loading} className="shrink-0">
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {summary ? 'Régénérer' : 'Générer'}
        </Button>
      </div>
      {summary && (
        <div className="mt-4 border-t pt-4 text-sm leading-relaxed">
          <Markdown text={summary} />
        </div>
      )}
    </section>
  )
}

// --- Minimal, XSS-safe markdown rendering -----------------------------------
// Handles the light subset the prompt asks for: bold, bullet lists, headings,
// paragraphs. Renders to React nodes (no dangerouslySetInnerHTML).

function Markdown({ text }: { text: string }) {
  return <div className="space-y-2">{renderBlocks(text)}</div>
}

function renderBlocks(md: string): ReactNode[] {
  const out: ReactNode[] = []
  let list: ReactNode[] = []
  let key = 0
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`ul-${key++}`} className="list-disc space-y-1 pl-5">
          {list}
        </ul>,
      )
      list = []
    }
  }
  for (const raw of md.split('\n')) {
    const t = raw.trim()
    if (!t) {
      flush()
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(t)
    if (bullet) {
      list.push(<li key={`li-${key++}`}>{inline(bullet[1], key)}</li>)
      continue
    }
    flush()
    const heading = /^#{1,6}\s+(.*)$/.exec(t)
    if (heading) {
      out.push(
        <p key={`h-${key++}`} className="font-semibold">
          {inline(heading[1], key)}
        </p>,
      )
      continue
    }
    out.push(<p key={`p-${key++}`}>{inline(t, key)}</p>)
  }
  flush()
  return out
}

// Split a line on **bold** spans.
function inline(text: string, keyBase: number): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part)
    return bold ? (
      <strong key={`${keyBase}-${i}`}>{bold[1]}</strong>
    ) : (
      <span key={`${keyBase}-${i}`}>{part}</span>
    )
  })
}
