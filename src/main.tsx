import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './index.css'

// `npx convex dev` writes VITE_CONVEX_URL into .env.local. Until then we fall
// back to a placeholder so the app still boots (no live data yet).
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
if (!convexUrl) {
  console.warn(
    '[air] VITE_CONVEX_URL is not set — run `npx convex dev` to connect the backend.',
  )
}

const convex = new ConvexReactClient(convexUrl ?? 'https://placeholder.convex.cloud')
const convexQueryClient = new ConvexQueryClient(convex)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: convexQueryClient.hashFn(),
      queryFn: convexQueryClient.queryFn(),
      // Convex queries are reactive: the client pushes updates over its
      // WebSocket and writes them straight into this cache. So the data is
      // never "stale" in the refetch sense — tell TanStack to never refetch
      // on its own (mount/focus/reconnect), while live updates still flow.
      staleTime: Infinity,
      // Keep results (and their subscription) cached a while after the last
      // component unmounts, so navigating between pages doesn't re-load data.
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})
convexQueryClient.connect(queryClient)

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: { queryClient },
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ConvexProvider>
  </StrictMode>,
)
