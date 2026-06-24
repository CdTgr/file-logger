<template>
  <div>
    <div class="row q-gutter-sm q-mb-md items-end">
      <q-input
        v-model="search"
        dense
        outlined
        dark
        placeholder="Search…"
        clearable
        style="width: 220px"
        @keyup.enter="load(1)"
        @clear="load(1)"
      >
        <template #append><q-icon name="search" /></template>
      </q-input>
      <q-input
        v-model="from"
        type="date"
        dense
        outlined
        dark
        label="From"
        style="width: 150px"
      />
      <q-input
        v-model="to"
        type="date"
        dense
        outlined
        dark
        label="To"
        style="width: 150px"
      />
      <q-select
        v-model="level"
        :options="levelOpts"
        dense
        outlined
        dark
        emit-value
        map-options
        style="width: 130px"
      />
      <q-select
        v-model="limit"
        :options="[50, 100, 200, 500]"
        dense
        outlined
        dark
        label="Limit"
        style="width: 90px"
        @update:model-value="load(1)"
      />
      <q-btn label="Search" color="primary" dense @click="load(1)" />
      <q-btn label="Reset" flat dense @click="reset" />
    </div>

    <div class="text-caption text-secondary q-mb-sm">
      {{ total.toLocaleString() }} results
    </div>

    <div v-if="loading" class="row justify-center q-pa-xl">
      <q-spinner size="48px" color="primary" />
    </div>

    <q-table
      v-else
      dark
      flat
      bordered
      dense
      :rows="rows"
      :columns="columns"
      row-key="id"
      :pagination="pagination"
      hide-pagination
      class="mono"
      style="cursor: pointer"
      @row-click="(_e, row) => openDetail(row as LogRow)"
    >
      <template #body-cell-level="{ value }">
        <q-td
          ><span :class="`lvl lvl-${value}`">{{ value }}</span></q-td
        >
      </template>
      <template #body-cell-status_code="{ value }">
        <q-td
          :style="
            value >= 500 ? 'color:#ff4d63' : value >= 400 ? 'color:#F2C037' : ''
          "
          >{{ value ?? '' }}</q-td
        >
      </template>
      <template #body-cell-response_time="{ value }">
        <q-td
          :style="
            value > 5000 ? 'color:#ff4d63' : value > 1000 ? 'color:#F2C037' : ''
          "
        >
          {{ value != null ? value.toFixed(0) + 'ms' : '–' }}
        </q-td>
      </template>
      <template #body-cell-timestamp="{ value }">
        <q-td class="mono">{{ fmtTs(value) }}</q-td>
      </template>
    </q-table>

    <div class="row items-center q-mt-sm q-gutter-sm">
      <q-btn
        icon="chevron_left"
        flat
        dense
        :disable="page <= 1"
        @click="load(page - 1)"
      />
      <span class="text-caption text-secondary"
        >Page {{ page }} of {{ totalPages }}</span
      >
      <q-btn
        icon="chevron_right"
        flat
        dense
        :disable="page >= totalPages"
        @click="load(page + 1)"
      />
    </div>

    <LogDetailModal v-model="detailOpen" :row="detailRow" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

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
const limit = ref(200)
const page = ref(1)
const total = ref(0)
const rows = ref<LogRow[]>([])
const loading = ref(false)
const detailOpen = ref(false)
const detailRow = ref<LogRow | null>(null)

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
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / limit.value)),
)
const pagination = computed(() => ({
  rowsPerPage: limit.value,
  page: page.value,
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
    style: 'width:60px',
  },
  {
    name: 'status_code',
    label: 'Status',
    field: 'status_code',
    align: 'center' as const,
    style: 'width:60px',
  },
  {
    name: 'response_time',
    label: 'RT',
    field: 'response_time',
    align: 'right' as const,
    style: 'width:70px',
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

async function load(p: number) {
  page.value = p
  loading.value = true
  try {
    const data = await api.logs({
      file: store.selectedFile || undefined,
      from: from.value || undefined,
      to: to.value || undefined,
      level: level.value !== 'ALL' ? level.value : undefined,
      q: search.value || undefined,
      page: p,
      limit: limit.value,
    })
    rows.value = data.rows
    total.value = data.total
  } catch {
  } finally {
    loading.value = false
  }
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
