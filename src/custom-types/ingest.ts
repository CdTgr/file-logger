/** Options for the `runIngest` function. */
export interface IngestOptions {
  force?: boolean
  checkOnly?: boolean
  logsDir?: string
  dbPath?: string
}
