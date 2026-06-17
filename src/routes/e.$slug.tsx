import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { ArrowUp, MessageSquare } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/e/$slug')({
  component: EditionView,
})

// Public, read-only view of an archived edition (shared via its slug).
function EditionView() {
  const { slug } = Route.useParams()
  const { data: edition, isPending } = useQuery(
    convexQuery(api.editions.getBySlug, { slug }),
  )

  if (isPending) {
    return <p className="text-center text-sm text-muted-foreground">Chargement…</p>
  }
  if (!edition) {
    return <p className="text-center text-sm text-muted-foreground">Édition introuvable.</p>
  }

  const date = new Date(edition.createdAt).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const filled = edition.sections.filter((s) => s.items.length > 0)

  return (
    <div className="space-y-8">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold">{edition.digestName}</h1>
        <p className="text-sm text-muted-foreground capitalize">{date}</p>
      </header>

      {filled.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">Édition vide.</p>
      ) : (
        <div className="space-y-10">
          {filled.map((section, i) => (
            <section key={i}>
              <h2 className="mb-3 text-lg font-semibold">{section.sourceName}</h2>
              <Separator className="mb-3" />
              <ul className="space-y-4">
                {section.items.map((item, j) => (
                  <li key={j}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {item.title}
                    </a>
                    {(item.score != null || item.commentsCount != null) && (
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        {item.score != null && (
                          <span className="flex items-center gap-1">
                            <ArrowUp className="size-3" />
                            {item.score}
                          </span>
                        )}
                        {item.commentsCount != null && (
                          <span className="flex items-center gap-1">
                            <MessageSquare className="size-3" />
                            {item.commentsCount}
                          </span>
                        )}
                      </div>
                    )}
                    {item.excerpt && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {item.excerpt}
                      </p>
                    )}
                    {(item.author || item.publishedAt) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        {item.author && <span className="max-w-[12rem] truncate">{item.author}</span>}
                        {item.publishedAt && (
                          <span>{new Date(item.publishedAt).toLocaleDateString('fr-FR')}</span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
