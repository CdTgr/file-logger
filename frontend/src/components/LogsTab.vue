<template>
  <div>
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-input
        v-model="search"
        outlined
        placeholder="Search…"
        clearable
        style="width: 240px"
        @keyup.enter="load(1)"
        @clear="load(1)"
      >
        <template #append><q-icon name="sym_o_search" /></template>
      </q-input>

      <q-input
        v-model="from"
        outlined
        label="From"
        style="width: 160px"
        readonly
      >
        <template #append>
          <q-icon name="sym_o_event" class="cursor-pointer">
            <q-popup-proxy
              cover
              transition-show="scale"
              transition-hide="scale"
            >
              <q-date v-model="from" mask="YYYY-MM-DD">
                <div class="row items-center justify-end">
                  <q-btn
                    v-close-popup
                    label="Close"
                    color="primary"
                    flat
                    no-caps
                  />
                </div>
              </q-date>
            </q-popup-proxy>
          </q-icon>
        </template>
      </q-input>

      <q-input v-model="to" outlined label="To" style="width: 160px" readonly>
        <template #append>
          <q-icon name="sym_o_event" class="cursor-pointer">
            <q-popup-proxy
              cover
              transition-show="scale"
              transition-hide="scale"
            >
              <q-date v-model="to" mask="YYYY-MM-DD">
                <div class="row items-center justify-end">
                  <q-btn
                    v-close-popup
                    label="Close"
                    color="primary"
                    flat
                    no-caps
                  />
                </div>
              </q-date>
            </q-popup-proxy>
          </q-icon>
        </template>
      </q-input>

      <q-select
        v-model="level"
        :options="levelOpts"
        outlined
        label="Level"
        emit-value
        map-options
        style="width: 130px"
      />

      <q-btn label="Search" color="primary" no-caps @click="load(1)" />
      <q-btn label="Reset" flat no-caps @click="reset" />
    </div>

    <div v-if="loading" class="row justify-center q-pa-xl">
      <q-spinner size="48px" color="primary" />
    </div>

    <q-table
      v-else
      flat
      bordered
      dense
      :rows="rows"
      :columns="columns"
      row-key="id"
      v-model:pagination="tablePagination"
      :rows-per-page-options="[50, 100, 200, 500]"
      class="mono"
      style="cursor: pointer"
      @row-click="(_e, row) => openDetail(row as LogRow)"
      @request="onRequest"
    >
      <template #body-cell-level="{ value }">
        <q-td
          ><span :class="`lvl lvl-${value}`">{{ value }}</span></q-td
        >
      </template>
      <template #body-cell-status_code="{ value }">
        <q-td
          :style="
            value >= 500 ? 'color:#FF453A' : value >= 400 ? 'color:#FFD60A' : ''
          "
        >
          {{ value ?? '' }}
        </q-td>
      </template>
      <template #body-cell-response_time="{ value }">
        <q-td
          :style="
            value > 5000 ? 'color:#FF453A' : value > 1000 ? 'color:#FFD60A' : ''
          "
        >
          {{ value != null ? value.toFixed(0) + 'ms' : '–' }}
        </q-td>
      </template>
      <template #body-cell-timestamp="{ value }">
        <q-td class="mono">{{ fmtTs(value) }}</q-td>
      </template>
    </q-table>

    <LogDetailModal v-model="detailOpen" :row="detailRow" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

import { api } from '../api'
import type { LogRow } from '../api/types'
import { useAppStore } from '../stores/appStore'
import LogDetailModal from './LogDetailModal.vue'

const store = useAppStore()

const today = new Date().toISOString().slice(0, 10)
const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
  .toISOString()
  .slice(0, 10)

const search = ref('')
const from = ref(thirtyDaysAgo)
const to = ref(today)
const level = ref('ALL')
const total = ref(0)
const rows = ref<LogRow[]>([])
const loading = ref(false)
const detailOpen = ref(false)
const detailRow = ref<LogRow | null>(null)

const tablePagination = ref({
  page: 1,
  rowsPerPage: 200,
  rowsNumber: 0,
})

const levelOpts = [
  'ALL',
  'TRACE',
  'DEBUG',
  'INFO',
  'WARN',
  'ERROR',
  'FATAL',
].map((l) => ({
  label: l,
  value: l,
}))

function fmtTs(iso: string) {
  return iso
    ? new Date(iso).toLocaleString('en-GB', {
        dateStyle: 'short',
        timeStyle: 'medium',
      })
    : '–'
}

const columns = [
  {
    name: 'timestamp',
    label: 'Time',
    field: 'timestamp',
    align: 'left' as const,
    style: 'width:140px',
  },
  {
    name: 'level',
    label: 'Level',
    field: 'level',
    align: 'center' as const,
    style: 'width:70px',
  },
  {
    name: 'method',
    label: 'Method',
    field: 'method',
    align: 'left' as const,
    style: 'width:65px',
  },
  {
    name: 'status_code',
    label: 'Status',
    field: 'status_code',
    align: 'center' as const,
    style: 'width:65px',
  },
  {
    name: 'response_time',
    label: 'RT',
    field: 'response_time',
    align: 'right' as const,
    style: 'width:75px',
  },
  {
    name: 'url',
    label: 'URL',
    field: 'url',
    align: 'left' as const,
    classes: 'ellipsis',
    style: 'max-width:220px',
  },
  {
    name: 'message',
    label: 'Message',
    field: 'message',
    align: 'left' as const,
    classes: 'ellipsis',
    style: 'max-width:400px',
  },
]

async function load(
  p = tablePagination.value.page,
  perPage = tablePagination.value.rowsPerPage,
) {
  loading.value = true
  try {
    const data = await api.logs({
      file: store.selectedFile || undefined,
      from: from.value || undefined,
      to: to.value || undefined,
      level: level.value !== 'ALL' ? level.value : undefined,
      q: search.value || undefined,
      page: p,
      limit: perPage,
    })
    rows.value = data.rows
    total.value = data.total
    tablePagination.value = {
      page: p,
      rowsPerPage: perPage,
      rowsNumber: data.total,
    }
  } catch {
  } finally {
    loading.value = false
  }
}

function onRequest(props: {
  pagination: { page: number; rowsPerPage: number }
}) {
  void load(props.pagination.page, props.pagination.rowsPerPage)
}

function reset() {
  search.value = ''
  from.value = thirtyDaysAgo
  to.value = today
  level.value = 'ALL'
  void load(1)
}

function openDetail(row: LogRow) {
  detailRow.value = row
  detailOpen.value = true
}

watch(
  () => store.selectedFile,
  () => load(1),
)
onMounted(() => load(1))
</script>
