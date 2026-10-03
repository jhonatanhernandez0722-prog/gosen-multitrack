import type { GosenApi } from './api'

declare global {
  interface Window {
    gosen: GosenApi
  }
}

export {}
