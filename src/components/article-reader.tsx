import { useMemo, useState } from 'react'
import { useAction } from 'convex/react'
import DOMPurify from 'dompurify'
import { BookOpen, ExternalLink, Loader2 } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type Article = {
  title: string
  byline?: string
  siteName?: string
  excerpt?: string
  content: string
}

// A "reader mode" trigger + near-fullscreen drawer that lazily extracts and
// renders a clean version of the article (Convex `reader.read` action).
export function ArticleReader({ url, title }: { url: string; title: string }) {
  const read = useAction(api.reader.read)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [article, setArticle] = useState<Article | null>(null)
  const [error, setError] = useState<string | null>(null)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next && !article && !loading) {
      setLoading(true)
      setError(null)
      read({ url })
        .then((a) => setArticle(a))
        .catch((e) => setError(e instanceof Error ? e.message : 'Échec du chargement'))
        .finally(() => setLoading(false))
    }
  }

  const subtitle = [article?.byline, article?.siteName].filter(Boolean).join(' · ')

  // Second layer of defense over the server-side cleanup before we inject HTML.
  const safeContent = useMemo(
    () =>
      article
        ? DOMPurify.sanitize(article.content, { ADD_ATTR: ['target'] })
        : '',
    [article],
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DrawerTrigger asChild>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Lire en mode lecture"
            >
              <BookOpen className="size-3.5" />
            </button>
          </DrawerTrigger>
        </TooltipTrigger>
        <TooltipContent>Mode lecture</TooltipContent>
      </Tooltip>

      <DrawerContent className="h-[94vh]">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-4">
          <DrawerHeader className="px-0">
            <DrawerTitle className="text-left text-xl leading-snug">
              {article?.title || title}
            </DrawerTitle>
            {subtitle ? (
              <DrawerDescription className="text-left">{subtitle}</DrawerDescription>
            ) : (
              <DrawerDescription className="sr-only">
                Lecture de l'article
              </DrawerDescription>
            )}
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto pb-10">
            {loading && (
              <div className="flex justify-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="py-16 text-center text-sm text-muted-foreground">
                <p>{error}</p>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 underline"
                >
                  Ouvrir l'original <ExternalLink className="size-3.5" />
                </a>
              </div>
            )}
            {article && (
              <article
                className="reader-content"
                dangerouslySetInnerHTML={{ __html: safeContent }}
              />
            )}
          </div>

          <div className="border-t py-3">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Voir l'article original <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
