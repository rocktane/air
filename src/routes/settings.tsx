import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../convex/_generated/api'
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { data: settings, isPending } = useQuery(convexQuery(api.settings.get, {}))
  const update = useMutation(api.settings.update)

  function save(patch: { schedule?: 'daily' | 'weekly' }) {
    update(patch).catch(() => toast.error('Échec de la sauvegarde'))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Réglages</h1>
        <p className="text-sm text-muted-foreground">
          Fréquence du digest. Le nombre d'articles se règle sur chaque source.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">Fréquence</CardTitle>
            <CardDescription>Quand recevoir le digest.</CardDescription>
          </div>
          <CardAction className="self-center">
            <Tabs
              value={settings?.schedule ?? 'daily'}
              onValueChange={(v) => save({ schedule: v as 'daily' | 'weekly' })}
            >
              <TabsList>
                <TabsTrigger value="daily" disabled={isPending}>
                  Quotidien
                </TabsTrigger>
                <TabsTrigger value="weekly" disabled={isPending}>
                  Hebdomadaire
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardAction>
        </CardHeader>
      </Card>
    </div>
  )
}
