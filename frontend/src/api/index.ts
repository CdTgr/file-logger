import type {
  HttpStatusStat,
  LevelCount,
  LogFilters,
  LogsResponse,
  StatusResponse,
  SummaryStats,
  TimelineBucket,
  TimelineStackedBucket,
  UrlStat,
} from './types'

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v)
  }
  const s = p.toString()
  return s ? '?' + s : ''
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

export const api = {
  status: () => get<StatusResponse>('/api/status'),

  files: () => get<string[]>('/api/files'),

  logs: (filters: LogFilters & { q?: string; page?: number; limit?: number }) =>
    get<LogsResponse>(
      '/api/logs' +
        qs({
          file: filters.file,
          level: filters.level,
          from: filters.from,
          to: filters.to,
          q: filters.q,
          page: filters.page?.toString(),
          limit: filters.limit?.toString(),
        }),
    ),

  summary: (filters: LogFilters) =>
    get<SummaryStats>('/api/stats/summary' + qs(filters as Record<string, string>)),

  levels: (filters: LogFilters) =>
    get<LevelCount[]>('/api/stats/levels' + qs(filters as Record<string, string>)),

  timeline: (filters: LogFilters & { interval?: string }) =>
    get<TimelineBucket[]>('/api/stats/timeline' + qs(filters as Record<string, string>)),

  timelineStacked: (filters: LogFilters & { interval?: string }) =>
    get<TimelineStackedBucket[]>(
      '/api/stats/timeline-stacked' + qs(filters as Record<string, string>),
    ),

  urls: (filters: LogFilters) =>
    get<UrlStat[]>('/api/stats/urls' + qs(filters as Record<string, string>)),

  httpStatus: (filters: LogFilters) =>
    get<HttpStatusStat[]>('/api/stats/http-status' + qs(filters as Record<string, string>)),

  ingest: (force = false) =>
    fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    }).then(
      (r) => r.json() as Promise<{ success: boolean; totalInserted: number; error?: string }>,
    ),

  downloadUrl: (file: string) => `/api/files/download?file=${encodeURIComponent(file)}`,
}
