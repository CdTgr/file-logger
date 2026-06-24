<template>
  <div>
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

const rows = ref<LogRow[]>([])
const loading = ref(false)
const detailOpen = ref(false)
const detailRow = ref<LogRow | null>(null)

const tablePagination = ref({
  page: 1,
  rowsPerPage: 200,
  rowsNumber: 0,
})

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
      from: store.filterFrom || undefined,
      to: store.filterTo || undefined,
      level: store.filterLevel !== 'ALL' ? store.filterLevel : undefined,
      q: store.filterSearch || undefined,
      page: p,
      limit: perPage,
    })
    rows.value = data.rows
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

function openDetail(row: LogRow) {
  detailRow.value = row
  detailOpen.value = true
}

watch(
  () => [
    store.selectedFile,
    store.filterFrom,
    store.filterTo,
    store.filterLevel,
    store.filterSearch,
  ],
  () => load(1),
)
onMounted(() => load(1))
</script>
