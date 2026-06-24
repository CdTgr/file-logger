<template>
  <div>
    <div class="row q-gutter-sm q-mb-md items-end">
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
      <q-btn label="Apply" color="primary" dense @click="loadAll" />
      <q-btn label="Reset" flat dense @click="reset" />
    </div>

    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-5">
        <q-card dark bordered>
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">HTTP Status Distribution</div>
            <HttpStatusChart :data="httpStatus" :loading="loadingHttp" />
          </q-card-section>
        </q-card>
      </div>

      <div class="col-12 col-md-7">
        <q-card dark bordered>
          <q-card-section>
            <div class="text-subtitle1 q-mb-sm">Top URLs</div>
            <div v-if="loadingUrls" class="row justify-center q-pa-lg">
              <q-spinner size="40px" color="primary" />
            </div>
            <q-table
              v-else
              dark
              flat
              dense
              :rows="urlRows"
              :columns="urlCols"
              row-key="path"
              :pagination="{ rowsPerPage: 25 }"
              hide-pagination
            />
          </q-card-section>
        </q-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

import { api } from '../api'
import type { HttpStatusStat, UrlStat } from '../api/types'
import { useAppStore } from '../stores/appStore'
import HttpStatusChart from './HttpStatusChart.vue'

const store = useAppStore()
const today = new Date().toISOString().slice(0, 10)
const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
  .toISOString()
  .slice(0, 10)
const from = ref(thirtyDaysAgo)
const to = ref(today)
const httpStatus = ref<HttpStatusStat[]>([])
const urlRows = ref<UrlStat[]>([])
const loadingHttp = ref(false)
const loadingUrls = ref(false)

const urlCols = [
  {
    name: 'path',
    label: 'Path',
    field: 'path',
    align: 'left' as const,
    classes: 'ellipsis',
    style: 'max-width:260px',
  },
  { name: 'count', label: 'Requests', field: 'count', align: 'right' as const },
  {
    name: 'avg_ms',
    label: 'Avg RT',
    field: 'avg_ms',
    align: 'right' as const,
    format: (v: number | null) => (v != null ? v.toFixed(0) + 'ms' : '–'),
  },
  { name: 'errors', label: 'Errors', field: 'errors', align: 'right' as const },
]

function filters() {
  return {
    file: store.selectedFile || undefined,
    from: from.value || undefined,
    to: to.value || undefined,
  }
}

async function loadAll() {
  loadingHttp.value = true
  loadingUrls.value = true
  try {
    const [h, u] = await Promise.all([
      api.httpStatus(filters()),
      api.urls(filters()),
    ])
    httpStatus.value = h
    urlRows.value = u
  } catch {
  } finally {
    loadingHttp.value = false
    loadingUrls.value = false
  }
}

function reset() {
  from.value = thirtyDaysAgo
  to.value = today
  void loadAll()
}

watch(
  () => store.selectedFile,
  () => loadAll(),
)
onMounted(() => loadAll())
</script>
