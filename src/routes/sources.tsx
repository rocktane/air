import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useAction, useMutation } from 'convex/react'
import { toast } from 'sonner'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus,
  Minus,
  RefreshCw,
  Trash2,
  ExternalLink,
  Sparkles,
  Pencil,
  GripVertical,
  MoreVertical,
  MonitorPlay,
  Newspaper,
  Code2,
  Flame,
  Rss,
  Globe,
  MessageCircle,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SourceLogo } from '@/components/source-icon'
import { domainOf } from '@/lib/favicon'

export const Route = createFileRoute('/sources')({
  component: SourcesPage,
})

type SourceType = Doc<'sources'>['type']

const KIND_META: Record<
  SourceType,
  { label: string; icon: typeof Rss; color: string; subtitle: string }
> = {
  producthunt: { label: 'Product Hunt', icon: Flame, color: 'text-orange-500', subtitle: 'Top du jour' },
  hackernews: { label: 'Hacker News', icon: Newspaper, color: 'text-orange-600', subtitle: 'Front page' },
  devto: { label: 'dev.to', icon: Code2, color: 'text-foreground', subtitle: 'Top de la semaine' },
  rss: { label: 'RSS', icon: Rss, color: 'text-amber-500', subtitle: 'Flux RSS' },
  website: { label: 'Site', icon: Globe, color: 'text-sky-500', subtitle: 'Site web' },
  youtube: { label: 'YouTube', icon: MonitorPlay, color: 'text-red-500', subtitle: 'Chaîne' },
  subreddit: { label: 'Reddit', icon: MessageCircle, color: 'text-orange-500', subtitle: 'Subreddit' },
}

function absolutize(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

// Guess the source type (and a friendly name) from a pasted URL / handle.
function detectSource(input: string): { type: SourceType; url: string; name: string } {
  const raw = input.trim()
  const sub =
    raw.match(/^\/?r\/([\w-]+)$/i)?.[1] ?? raw.match(/reddit\.com\/r\/([\w-]+)/i)?.[1]
  if (sub) return { type: 'subreddit', url: `https://www.reddit.com/r/${sub}`, name: `r/${sub}` }
  if (/(?:youtube\.com|youtu\.be)/i.test(raw)) {
    const handle = raw.match(/@([\w.-]+)/)?.[1]
    return { type: 'youtube', url: absolutize(raw), name: handle ? `YouTube · ${handle}` : 'YouTube' }
  }
  if (/dev\.to/i.test(raw)) {
    const tag = raw.match(/dev\.to\/t\/([\w-]+)/i)?.[1]
    return { type: 'devto', url: absolutize(raw), name: tag ? `dev.to · ${tag}` : 'dev.to' }
  }
  if (
    /\.(xml|rss|atom)(\?|$)/i.test(raw) ||
    /\/(feed|rss|atom)\/?(\?|$)/i.test(raw) ||
    /\/feeds?\//i.test(raw)
  ) {
    return { type: 'rss', url: absolutize(raw), name: domainOf(raw) ?? 'Flux RSS' }
  }
  // A generic site: track the whole blog (its homepage), not the single article
  // the user happened to paste.
  const url = absolutize(raw)
  let siteUrl = url
  try {
    siteUrl = new URL(url).origin
  } catch {
    /* keep raw */
  }
  return { type: 'website', url: siteUrl, name: domainOf(url) ?? raw }
}

function SourcesPage() {
  const { data: sources, isPending } = useQuery(convexQuery(api.sources.list, {}))
  const ensureSeeded = useMutation(api.sources.ensureSeeded)
  const reorder = useMutation(api.sources.reorder)

  // Make sure the curated presets always exist (disabled) for the user to toggle.
  useEffect(() => {
    ensureSeeded({}).catch(() => {})
  }, [ensureSeeded])

  // Local ordering for instant drag feedback; re-adopt the server order whenever
  // the set of sources changes (add / remove / first load), without an effect.
  const serverIds = (sources ?? []).map((s) => String(s._id))
  const [order, setOrder] = useState<string[]>(serverIds)
  const sameSet =
    order.length === serverIds.length && order.every((id) => serverIds.includes(id))
  if (!sameSet) setOrder(serverIds)

  const byId = new Map((sources ?? []).map((s) => [String(s._id), s]))
  const ordered = order.map((id) => byId.get(id)).filter(Boolean) as Doc<'sources'>[]

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = order.indexOf(String(active.id))
    const to = order.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const next = arrayMove(order, from, to)
    setOrder(next)
    reorder({ ids: next as Id<'sources'>[] })
      .then(() => toast.success('Ordre mis à jour'))
      .catch(() => toast.error('Échec du réordonnancement'))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sources</h1>
          <p className="text-sm text-muted-foreground">
            Active les sources, règle-les, et glisse pour réordonner.
          </p>
        </div>
        <AddSourceDialog />
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune source.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="grid gap-3">
              {ordered.map((source) => (
                <SourceRow key={source._id} source={source} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

// Name shown as an always-editable input: hover highlights it, Enter/blur saves.
function EditableName({ source }: { source: Doc<'sources'> }) {
  const rename = useMutation(api.sources.rename)
  const [value, setValue] = useState(source.name)
  // Re-sync when the name changes externally, without an effect.
  const [prevName, setPrevName] = useState(source.name)
  if (source.name !== prevName) {
    setPrevName(source.name)
    setValue(source.name)
  }

  function commit() {
    const next = value.trim()
    if (!next) return setValue(source.name)
    if (next !== source.name) {
      rename({ id: source._id, name: next })
        .then(() => toast.success('Nom mis à jour'))
        .catch(() => {
          setValue(source.name)
          toast.error('Renommage échoué')
        })
    }
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setValue(source.name)
          e.currentTarget.blur()
        }
      }}
      aria-label="Nom de la source"
      size={1}
      className="field-sizing-content max-w-full min-w-[2ch] rounded bg-transparent px-1 py-0.5 text-base font-medium outline-none hover:bg-muted focus:bg-muted focus:ring-1 focus:ring-ring"
    />
  )
}

function SourceRow({ source }: { source: Doc<'sources'> }) {
  const setEnabled = useMutation(api.sources.setEnabled)
  const setIncludeShorts = useMutation(api.sources.setIncludeShorts)
  const setShowDescription = useMutation(api.sources.setShowDescription)
  const setMaxItems = useMutation(api.sources.setMaxItems)
  const removeSource = useMutation(api.sources.remove)
  const restoreSource = useMutation(api.sources.restore)
  const refresh = useAction(api.fetchers.refreshSource)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: source._id })

  const meta = KIND_META[source.type]
  const Icon = meta.icon
  const isYoutube = source.type === 'youtube'
  const isBlog = source.type === 'rss' || source.type === 'website'

  // Per-source item cap. YouTube only offers 2 or 4 (the RSS feed yields few
  // long-form videos, and the digest grids them two per row).
  const step = isYoutube ? 2 : 1
  const minItems = step
  const maxItemsCap = isYoutube ? 4 : 30
  const count = Math.min(
    Math.max(source.maxItems ?? (isYoutube ? 4 : 5), minItems),
    maxItemsCap,
  )

  function setCount(value: number) {
    setMaxItems({ id: source._id, value }).catch(() =>
      toast.error('Échec de la mise à jour'),
    )
  }

  const updatedAt = source.lastFetchedAt
    ? new Date(source.lastFetchedAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  async function handleRefresh(allowLlm: boolean) {
    setBusy(true)
    try {
      const r = await refresh({ sourceId: source._id, allowLlm })
      if (r.needsManualScan) {
        toast.info("Extraction auto impossible — utilise « Scan manuel ».")
      } else {
        toast.success(`${r.inserted} nouveau(x) · ${r.total} récupéré(s)`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec du refresh')
    } finally {
      setBusy(false)
    }
  }

  async function handleShorts(value: boolean) {
    try {
      await setIncludeShorts({ id: source._id, value })
      handleRefresh(false) // re-fetch so the filter applies right away
    } catch {
      toast.error('Échec de la mise à jour')
    }
  }

  async function handleDelete() {
    try {
      const snapshot = await removeSource({ id: source._id })
      if (!snapshot) return
      toast.success(`« ${source.name} » supprimée`, {
        action: {
          label: 'Annuler',
          onClick: () => {
            restoreSource(snapshot)
              .then((id) => refresh({ sourceId: id, allowLlm: false }).catch(() => {}))
              .catch(() => toast.error('Échec de la restauration'))
          },
        },
      })
    } catch {
      toast.error('Échec de la suppression')
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-10')}
    >
      <Card
        className={cn(
          'flex-row items-center gap-2 py-0 transition-opacity',
          !source.enabled && 'opacity-60',
          isDragging && 'shadow-lg',
        )}
      >
        <div className="flex w-full items-center gap-2 p-3">
          <button
            type="button"
            className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label="Déplacer"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>

          <SourceLogo
            source={source}
            className="size-8"
            fallback={<Icon className={`size-8 shrink-0 ${meta.color}`} />}
          />

          <div className="min-w-0 flex-1">
            <EditableName source={source} />
            <div className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
              <span className="truncate">{source.url ?? meta.subtitle}</span>
              {source.url && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded p-0.5 hover:text-foreground"
                      aria-label="Ouvrir dans un nouvel onglet"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>Ouvrir dans un nouvel onglet</TooltipContent>
                </Tooltip>
              )}
              {updatedAt && <span className="shrink-0">· maj {updatedAt}</span>}
            </div>
            {source.needsManualScan && (
              <p className="px-1 text-xs text-amber-600">
                L'URL n'a pas pu être ajoutée automatiquement.
              </p>
            )}
          </div>

          {!source.enabled && (
            <span className="shrink-0 text-xs text-muted-foreground">Inactif</span>
          )}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label="Réglages de la source"
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Réglages</TooltipContent>
            </Tooltip>

            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled={busy} onSelect={() => handleRefresh(false)}>
                <RefreshCw className="size-4" />
                Rafraîchir
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                Éditer
              </DropdownMenuItem>
              {source.needsManualScan && (
                <DropdownMenuItem disabled={busy} onSelect={() => handleRefresh(true)}>
                  <Sparkles className="size-4" />
                  Scan manuel (IA)
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <div className="flex items-center justify-between px-2 py-1.5 text-sm">
                <span>Articles</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-6"
                    disabled={count <= minItems}
                    onClick={() => setCount(count - step)}
                    aria-label="Moins d'articles"
                  >
                    <Minus className="size-3" />
                  </Button>
                  <span className="w-5 text-center tabular-nums">{count}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-6"
                    disabled={count >= maxItemsCap}
                    onClick={() => setCount(count + step)}
                    aria-label="Plus d'articles"
                  >
                    <Plus className="size-3" />
                  </Button>
                </div>
              </div>

              <DropdownMenuSeparator />

              {isYoutube && (
                <DropdownMenuCheckboxItem
                  checked={source.includeShorts ?? true}
                  onCheckedChange={handleShorts}
                  onSelect={(e) => e.preventDefault()}
                >
                  Shorts
                </DropdownMenuCheckboxItem>
              )}
              {isBlog && (
                <DropdownMenuCheckboxItem
                  checked={source.showDescription ?? true}
                  onCheckedChange={(value) =>
                    setShowDescription({ id: source._id, value }).catch(() =>
                      toast.error('Échec de la mise à jour'),
                    )
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  Description
                </DropdownMenuCheckboxItem>
              )}
              <DropdownMenuCheckboxItem
                checked={source.enabled}
                onCheckedChange={(enabled) =>
                  setEnabled({ id: source._id, enabled }).catch(() =>
                    toast.error('Échec de la mise à jour'),
                  )
                }
                onSelect={(e) => e.preventDefault()}
              >
                Activé
              </DropdownMenuCheckboxItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                <Trash2 className="size-4" />
                Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>

      <EditSourceDialog source={source} open={editOpen} onOpenChange={setEditOpen} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {source.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              La source et ses articles seront retirés. Tu pourras annuler juste après.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Edit a source's name + url, then rebuild its data from scratch.
function EditSourceDialog({
  source,
  open,
  onOpenChange,
}: {
  source: Doc<'sources'>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const editSource = useMutation(api.sources.edit)
  const refresh = useAction(api.fetchers.refreshSource)
  const [name, setName] = useState(source.name)
  const [url, setUrl] = useState(source.url ?? '')
  const [saving, setSaving] = useState(false)
  const hasUrl = source.url != null

  // Reset the fields to the current source each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setName(source.name)
    setUrl(source.url ?? '')
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const detected = hasUrl && url.trim() ? detectSource(url) : null

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (hasUrl && !detected) return
    setSaving(true)
    try {
      await editSource({
        id: source._id,
        type: detected?.type ?? source.type,
        name: name.trim() || source.name,
        url: detected?.url,
      })
      onOpenChange(false)
      // Rebuild from zero (free path; LLM stays behind the manual scan).
      refresh({ sourceId: source._id, allowLlm: false })
        .then((r) =>
          r.needsManualScan
            ? toast.info('Mis à jour — extraction auto impossible, lance un « Scan manuel ».')
            : toast.success(`Mis à jour · ${r.inserted} article(s)`),
        )
        .catch((err) =>
          toast.error(err instanceof Error ? err.message : 'Récupération échouée'),
        )
    } catch {
      toast.error('Échec de la mise à jour')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Éditer la source</DialogTitle>
          <DialogDescription>
            Modifier l'URL relance l'extraction et recharge les articles de zéro.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nom</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          {hasUrl && (
            <div className="space-y-2">
              <Label htmlFor="edit-url">URL</Label>
              <Input
                id="edit-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
              />
              {detected && (
                <p className="text-xs text-muted-foreground">
                  Détecté : <span className="font-medium">{KIND_META[detected.type].label}</span>
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={saving || (hasUrl && !detected)}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddSourceDialog() {
  const addSource = useMutation(api.sources.add)
  const refresh = useAction(api.fetchers.refreshSource)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const detected = input.trim() ? detectSource(input) : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!detected) return
    setSubmitting(true)
    try {
      const id = await addSource({
        type: detected.type,
        url: detected.url,
        name: name.trim() || detected.name,
      })
      setOpen(false)
      setInput('')
      setName('')
      // Free auto-fetch right away (LLM stays behind the manual scan button).
      refresh({ sourceId: id, allowLlm: false })
        .then((r) =>
          r.needsManualScan
            ? toast.info('Ajoutée — extraction auto impossible, lance un « Scan manuel ».')
            : toast.success(`Ajoutée · ${r.inserted} article(s)`),
        )
        .catch((err) =>
          toast.error(err instanceof Error ? err.message : 'Récupération échouée'),
        )
    } catch {
      toast.error("Échec de l'ajout")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Ajouter
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter une source</DialogTitle>
          <DialogDescription>
            Colle une URL : flux RSS, site, chaîne YouTube, subreddit (r/…)… le type
            est détecté automatiquement.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source-input">URL</Label>
            <Input
              id="source-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://… ou r/programming ou @chaine"
              autoComplete="off"
              autoFocus
            />
            {detected && (
              <p className="text-xs text-muted-foreground">
                Détecté : <span className="font-medium">{KIND_META[detected.type].label}</span>
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-name">
              Nom <span className="text-muted-foreground">(optionnel)</span>
            </Label>
            <Input
              id="source-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={detected?.name ?? 'Auto'}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!detected || submitting}>
              {submitting ? 'Ajout…' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
