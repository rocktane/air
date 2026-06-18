import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'

// Read-state for digest links, backed by the `reads` table. The list query is
// shared (react-query dedupes by key) so every item subscribes to one source of
// truth; mutations are fire-and-forget (Convex reactivity refreshes the set).
export function useReads() {
  const { data } = useQuery(convexQuery(api.reads.list, {}))
  const markReadMut = useMutation(api.reads.markRead)
  const toggleMut = useMutation(api.reads.toggle)

  const readSet = useMemo(() => new Set(data ?? []), [data])
  const isRead = useCallback((url: string) => readSet.has(url), [readSet])
  const markRead = useCallback(
    (url: string) => {
      if (!readSet.has(url)) markReadMut({ url }).catch(() => {})
    },
    [markReadMut, readSet],
  )
  const toggle = useCallback(
    (url: string) => {
      toggleMut({ url }).catch(() => {})
    },
    [toggleMut],
  )

  return { isRead, markRead, toggle }
}
