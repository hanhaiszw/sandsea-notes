/// <reference types="vite/client" />

import type { NotesApi } from '@shared/ipc'

declare global {
  interface Window {
    notes: NotesApi
  }
}
