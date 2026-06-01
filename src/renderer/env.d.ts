/// <reference types="vite/client" />

import type { KairoAPI } from '../preload/index'

declare global {
  interface Window {
    kairoAPI: KairoAPI
  }
}

export {}
