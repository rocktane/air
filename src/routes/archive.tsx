import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useAction, useMutation } from 'convex/react'
import { toast } from 'sonner'
import { Archive as ArchiveIcon, Copy, ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { useActiveDigest } from '@/lib/active-digest'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export const Route = createFileRoute('/archive')({
  component: ArchivePage,
})

function ArchivePage() {
  const { activeId, active } = useActiveDigest()
  const { data: editions, isPending } = useQuery(
    convexQuery(api.editions.list, { digestId: activeId }),
  )
  const archiveNow = useAction(api.editions.archiveNow)
  const removeEdition = useMutation(api.editions.remove)
  const [archiving, setArchiving] = useState(false)

  async function handleArchive() {
    if (!activeId) return
    setArchiving(true)
    try {
      await archiveNow({ digestId: activeId })
      toast.success('Édition archivée')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'archivage")
    } finally {
      setArchiving(false)
    }
  }

  function copyLink(slug: string) {
    const url = `${window.location.origin}/e/${slug}`
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Lien public copié'))
      .catch(() => toast.error('Échec de la copie'))
  }

  const list = editions ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Archive</h1>
          <p className="text-sm text-muted-foreground">
            Éditions passées de « {active?.name ?? '…'} ». Chaque édition a un lien public
            partageable.
          </p>
        </div>
        <Button onClick={handleArchive} disabled={archiving || !activeId}>
          {archiving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArchiveIcon className="size-4" />
          )}
          Archiver maintenant
        </Button>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          Aucune édition. Clique « Archiver maintenant », ou attends le prochain envoi programmé.
        </div>
      ) : (
        <div className="grid gap-3">
          {list.map((ed) => {
            const count = ed.sections.reduce((n, s) => n + s.items.length, 0)
            const date = new Date(ed.createdAt).toLocaleString('fr-FR', {
              dateStyle: 'full',
              timeStyle: 'short',
            })
            return (
              <Card key={ed._id} className="flex-row items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium capitalize">{date}</p>
                  <p className="text-xs text-muted-foreground">
                    {count} article(s) · {ed.sections.length} source(s)
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/e/$slug" params={{ slug: ed.slug }}>
                      <ExternalLink className="size-4" />
                      Voir
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Copier le lien public"
                    onClick={() => copyLink(ed.slug)}
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Supprimer l'édition"
                    onClick={() =>
                      removeEdition({ id: ed._id })
                        .then(() => toast.success('Édition supprimée'))
                        .catch(() => toast.error('Échec de la suppression'))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
