import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'

type ActiveDigestValue = {
  digests: Doc<'digests'>[]
  activeId: Id<'digests'> | undefined
  active: Doc<'digests'> | undefined
  setActiveId: (id: Id<'digests'>) => void
  isPending: boolean
}

const ActiveDigestContext = createContext<ActiveDigestValue | null>(null)

export function useActiveDigest() {
  const ctx = useContext(ActiveDigestContext)
  if (!ctx) throw new Error('useActiveDigest must be used within ActiveDigestProvider')
  return ctx
}

const STORAGE_KEY = 'air.activeDigestId'

export function ActiveDigestProvider({ children }: { children: ReactNode }) {
  const { data: digests, isPending } = useQuery(convexQuery(api.digests.list, {}))
  const ensureDefault = useMutation(api.digests.ensureDefault)

  // Create the first digest (and backfill orphan sources) once on load.
  useEffect(() => {
    ensureDefault({}).catch(() => {})
  }, [ensureDefault])

  const [stored, setStored] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })

  const list = useMemo(() => digests ?? [], [digests])
  const activeId = useMemo(() => {
    const valid = list.find((d) => String(d._id) === stored)
    return (valid?._id ?? list[0]?._id) as Id<'digests'> | undefined
  }, [list, stored])
  const active = list.find((d) => d._id === activeId)

  function setActiveId(id: Id<'digests'>) {
    setStored(String(id))
    try {
      localStorage.setItem(STORAGE_KEY, String(id))
    } catch {
      /* ignore */
    }
  }

  const value = useMemo(
    () => ({ digests: list, activeId, active, setActiveId, isPending }),
    [list, activeId, active, isPending],
  )

  return <ActiveDigestContext.Provider value={value}>{children}</ActiveDigestContext.Provider>
}
