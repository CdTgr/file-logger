<template>
  <q-dialog v-model="open">
    <q-card style="min-width: 560px; max-width: 760px; width: 100%">
      <q-card-section class="row items-center q-pb-none">
        <span v-if="row" :class="`lvl lvl-${row.level} q-mr-sm`">{{
          row.level
        }}</span>
        <span class="text-subtitle1">Log Entry</span>
        <q-space />
        <q-btn icon="close" flat round v-close-popup />
      </q-card-section>

      <q-separator />

      <q-card-section
        v-if="row"
        class="scroll"
        style="max-height: 70vh; overflow-y: auto"
      >
        <div
          class="q-mb-md"
          style="display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px"
        >
          <template v-for="[k, v] in fields" :key="k">
            <div class="text-caption text-secondary self-start">{{ k }}</div>
            <div class="text-body2 mono">{{ v }}</div>
          </template>
        </div>
        <q-separator class="q-mb-sm" />
        <div class="text-caption text-secondary q-mb-xs">Message</div>
        <pre
          class="mono text-body2"
          style="white-space: pre-wrap; word-break: break-all; margin: 0"
        >
          {{ prettyMsg }}
          </pre
        >
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { LogRow } from '../api/types'

const props = defineProps<{ modelValue: boolean; row: LogRow | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function fmtTs(iso: string) {
  return new Date(iso).toLocaleString()
}
function fmtRt(v: number | null) {
  if (v == null) return '–'
  return v < 1000 ? `${v.toFixed(0)}ms` : `${(v / 1000).toFixed(2)}s`
}

const fields = computed(() => {
  if (!props.row) return []
  const r = props.row
  return (
    [
      ['Time', r.timestamp ? fmtTs(r.timestamp) : '–'],
      ['File', r.log_file],
      ['Level', r.level],
      r.method ? ['Method', r.method] : null,
      r.url ? ['URL', r.url] : null,
      r.status_code != null ? ['Status', String(r.status_code)] : null,
      r.response_time != null
        ? ['Response Time', fmtRt(r.response_time)]
        : null,
      r.hostname ? ['Hostname', r.hostname] : null,
      r.pid ? ['PID', String(r.pid)] : null,
      r.req_id ? ['Req ID', r.req_id] : null,
    ] as ([string, string] | null)[]
  ).filter((x): x is [string, string] => x !== null)
})

const prettyMsg = computed(() => {
  const msg = props.row?.message ?? ''
  if (msg.startsWith('{') || msg.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(msg), null, 2)
    } catch {}
  }
  return msg
})
</script>
