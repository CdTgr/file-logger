/** Values that can be passed as positional params to node:sqlite statements. */
export type SqlParam = string | number | bigint | null

/** A single parsed log entry row, ready for insertion into the `logs` table. */
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
