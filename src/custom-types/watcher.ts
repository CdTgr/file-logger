import { LogRow } from './db.js'

/** Configuration for `startWatcher`. */
export interface WatcherConfig {
  logsDir: string
  dbPath: string
}

/** Per-file state tracked by the live watcher. */
export interface FileState {
  offset: number
  pending: LogRow | null
  debounceTimer?: ReturnType<typeof setTimeout>
  flushTimer?: ReturnType<typeof setTimeout>
}
