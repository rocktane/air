import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Only allow http/https URLs in an href. Item links come from external feeds,
// so a `javascript:` URL would be an XSS vector — return undefined for those
// (render the element without a navigable href).
export function safeHref(url?: string | null): string | undefined {
  if (!url) return undefined
  try {
    const p = new URL(url)
    return p.protocol === 'http:' || p.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

// Open a link in a new tab. `background: true` keeps focus on the current tab
// (the new tab opens behind it). Browsers won't let plain JS open a background
// tab, but a synthetic ctrl/meta-click on an anchor reproduces the native
// "open in background tab" gesture across Chrome/Firefox/Safari.
export function openExternal(url: string, background: boolean): void {
  const href = safeHref(url)
  if (!href) return
  if (!background) {
    window.open(href, '_blank', 'noopener,noreferrer')
    return
  }
  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noreferrer'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.dispatchEvent(
    new MouseEvent('click', {
      bubbles: false,
      cancelable: true,
      ctrlKey: true,
      metaKey: true,
    }),
  )
  a.remove()
}
