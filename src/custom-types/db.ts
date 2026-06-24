export interface LogRow {
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
