export interface LogRow {
  id: number
  log_file: string
  timestamp: string
  timestamp_unix: number
  level: string
  level_num: number | null
  message: string
  method: string | null
  url: string | null
  status_code: number | null
  response_time: number | null
  pid: number | null
  hostname: string | null
  req_id: string | null
}

export interface LogsResponse {
  rows: LogRow[]
  total: number
  page: number
  limit: number
}

export interface LevelCount {
  level: string
  count: number
}

export interface TimelineBucket {
  bucket: string
  count: number
}

export interface TimelineStackedBucket {
  bucket: string
  level: string
  count: number
}

export interface SummaryStats {
  total: number
  earliest: string | null
  latest: string | null
}

export interface UrlStat {
  path: string
  count: number
  avg_ms: number | null
  errors: number
}

export interface HttpStatusStat {
  group_label: string
  count: number
}

export interface StatusResponse {
  ready: boolean
  total?: number
  files?: IngestionLogEntry[]
}

export interface IngestionLogEntry {
  log_file: string
  ingested_at: string
  row_count: number
  file_size: number
}

export interface LogFilters {
  file?: string
  level?: string
  from?: string
  to?: string
}
