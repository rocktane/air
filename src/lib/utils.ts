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
