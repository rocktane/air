import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useAction, useMutation } from 'convex/react'
import { toast } from 'sonner'
import { Copy, Loader2, Send, Trash2 } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import { useActiveDigest } from '@/lib/active-digest'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { active, isPending } = useActiveDigest()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Réglages</h1>
        <p className="text-sm text-muted-foreground">
          Planning d'envoi, filtres anti-bruit et gestion du digest sélectionné.
        </p>
      </div>

      {isPending && !active ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !active ? (
        <p className="text-sm text-muted-foreground">Aucun digest.</p>
      ) : (
        <DigestSettings key={active._id} digest={active} />
      )}
    </div>
  )
}

const WEEKDAYS = [
  { value: '1', label: 'Lundi' },
  { value: '2', label: 'Mardi' },
  { value: '3', label: 'Mercredi' },
  { value: '4', label: 'Jeudi' },
  { value: '5', label: 'Vendredi' },
  { value: '6', label: 'Samedi' },
  { value: '0', label: 'Dimanche' },
]

const parseKeywords = (s: string) => s.split(',').map((k) => k.trim()).filter(Boolean)
const joinKeywords = (a?: string[]) => (a ?? []).join(', ')

function DigestSettings({ digest }: { digest: Doc<'digests'> }) {
  const { digests, setActiveId } = useActiveDigest()
  const rename = useMutation(api.digests.rename)
  const updateSchedule = useMutation(api.digests.updateSchedule)
  const updateFilters = useMutation(api.digests.updateFilters)
  const remove = useMutation(api.digests.remove)
  const clone = useMutation(api.digests.clone)
  const sendNow = useAction(api.email.sendNow)

  const { data: settings } = useQuery(convexQuery(api.settings.get, {}))
  const updateSettings = useMutation(api.settings.update)

  // Local form state, seeded from the digest (component is keyed by id so it
  // resets when the active digest changes).
  const [name, setName] = useState(digest.name)
  const [timezone, setTimezone] = useState(digest.timezone)
  const [sendHour, setSendHour] = useState(String(digest.sendHour ?? 8))
  const [emailTo, setEmailTo] = useState(digest.emailTo ?? '')
  const [include, setInclude] = useState(joinKeywords(digest.includeKeywords))
  const [exclude, setExclude] = useState(joinKeywords(digest.excludeKeywords))
  const [minScore, setMinScore] = useState(String(digest.minScore ?? 0))
  const [sending, setSending] = useState(false)

  const id = digest._id
  const fail = () => toast.error('Échec de la sauvegarde')

  function saveSchedule(patch: Parameters<typeof updateSchedule>[0]) {
    updateSchedule(patch).catch(fail)
  }

  async function handleSendTest() {
    setSending(true)
    try {
      await sendNow({ digestId: id })
      toast.success(`Test envoyé à ${digest.emailTo || 'digest@23o.dev'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'envoi")
    } finally {
      setSending(false)
    }
  }

  async function handleClone() {
    try {
      const newId = await clone({ id })
      if (newId) {
        setActiveId(newId)
        toast.success('Digest dupliqué')
      }
    } catch {
      toast.error('Échec de la duplication')
    }
  }

  async function handleDelete() {
    try {
      await remove({ id })
      const next = digests.find((d) => d._id !== id)
      if (next) setActiveId(next._id)
      toast.success('Digest supprimé')
    } catch {
      toast.error('Échec de la suppression')
    }
  }

  return (
    <div className="space-y-6">
      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Digest</CardTitle>
          <CardDescription>Nom du digest sélectionné.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="digest-name">Nom</Label>
          <Input
            id="digest-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const next = name.trim()
              if (next && next !== digest.name) rename({ id, name: next }).catch(fail)
              else setName(digest.name)
            }}
          />
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={handleClone}>
              <Copy className="size-4" />
              Dupliquer
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={digests.length <= 1}
                >
                  <Trash2 className="size-4" />
                  Supprimer
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer « {digest.name} » ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Le digest, ses sources et leurs articles seront définitivement supprimés.
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
        </CardContent>
      </Card>

      {/* Schedule + email delivery */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fréquence & envoi</CardTitle>
          <CardDescription>Quand recevoir ce digest par email (Brevo).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label>Fréquence</Label>
            <Tabs
              value={digest.schedule}
              onValueChange={(v) =>
                saveSchedule({ id, schedule: v as 'daily' | 'weekly' | 'off' })
              }
            >
              <TabsList>
                <TabsTrigger value="off">Off</TabsTrigger>
                <TabsTrigger value="daily">Quotidien</TabsTrigger>
                <TabsTrigger value="weekly">Hebdo</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {digest.schedule === 'weekly' && (
            <div className="flex items-center justify-between gap-4">
              <Label>Jour</Label>
              <Select
                value={String(digest.weekday ?? 1)}
                onValueChange={(v) => saveSchedule({ id, weekday: Number(v) })}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="send-hour">Heure d'envoi</Label>
            <Input
              id="send-hour"
              type="number"
              min={0}
              max={23}
              className="w-24"
              value={sendHour}
              onChange={(e) => setSendHour(e.target.value)}
              onBlur={() => {
                const h = Math.min(23, Math.max(0, Math.round(Number(sendHour) || 0)))
                setSendHour(String(h))
                saveSchedule({ id, sendHour: h })
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="timezone">Fuseau</Label>
            <Input
              id="timezone"
              className="w-56"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              onBlur={() => {
                const tz = timezone.trim() || 'Europe/Paris'
                setTimezone(tz)
                saveSchedule({ id, timezone: tz })
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-to">Email destinataire</Label>
            <Input
              id="email-to"
              type="email"
              placeholder="digest@23o.dev"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              onBlur={() => saveSchedule({ id, emailTo: emailTo.trim() })}
            />
            <p className="text-xs text-muted-foreground">
              L'expéditeur est l'adresse vérifiée dans Brevo (env <code>BREVO_SENDER</code>).
            </p>
          </div>

          <Button variant="outline" size="sm" onClick={handleSendTest} disabled={sending}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Envoyer un test maintenant
          </Button>
        </CardContent>
      </Card>

      {/* Noise filters + dedup */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtres & bruit</CardTitle>
          <CardDescription>
            S'appliquent à toutes les sources de ce digest.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="include">Mots-clés à inclure</Label>
            <Input
              id="include"
              placeholder="ia, react, convex"
              value={include}
              onChange={(e) => setInclude(e.target.value)}
              onBlur={() =>
                updateFilters({ id, includeKeywords: parseKeywords(include) }).catch(fail)
              }
            />
            <p className="text-xs text-muted-foreground">
              Si renseigné, seuls les articles contenant au moins un de ces mots passent.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="exclude">Mots-clés à exclure</Label>
            <Input
              id="exclude"
              placeholder="crypto, nft"
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              onBlur={() =>
                updateFilters({ id, excludeKeywords: parseKeywords(exclude) }).catch(fail)
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="min-score">Score minimum</Label>
              <p className="text-xs text-muted-foreground">
                Masque les items à faible score (HN, Reddit…). 0 = désactivé.
              </p>
            </div>
            <Input
              id="min-score"
              type="number"
              min={0}
              className="w-24"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              onBlur={() => {
                const n = Math.max(0, Math.round(Number(minScore) || 0))
                setMinScore(String(n))
                updateFilters({ id, minScore: n }).catch(fail)
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="dedupe">Dédupliquer entre sources</Label>
              <p className="text-xs text-muted-foreground">
                Un même lien n'apparaît qu'une fois (ex. HN + RSS).
              </p>
            </div>
            <Switch
              id="dedupe"
              checked={digest.dedupe ?? false}
              onCheckedChange={(dedupe) => updateFilters({ id, dedupe }).catch(fail)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Global default */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Défaut global</CardTitle>
          <CardDescription>
            Nombre d'articles par source quand aucune limite n'est fixée sur la source.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="max-items">Articles par source</Label>
            <Input
              id="max-items"
              type="number"
              min={1}
              max={30}
              className="w-24"
              defaultValue={settings?.maxItemsPerSource ?? 5}
              onBlur={(e) => {
                const n = Math.min(30, Math.max(1, Math.round(Number(e.target.value) || 5)))
                updateSettings({ maxItemsPerSource: n }).catch(fail)
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
