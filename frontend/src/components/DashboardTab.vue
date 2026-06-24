<template>
  <div>
    <div class="row q-gutter-sm q-mb-md items-end">
      <q-input v-model="from" type="date" dense outlined label="From" dark style="width:160px" />
      <q-input v-model="to" type="date" dense outlined label="To" dark style="width:160px" />
      <q-select
        v-model="level"
        :options="levelOptions"
        dense
        outlined
        label="Level"
        dark
        style="width:140px"
        emit-value
        map-options
      />
      <q-btn label="Apply" color="primary" dense @click="loadAll" />
      <q-btn label="Reset" flat dense @click="reset" />
    </div>

    <div class="row q-gutter-md q-mb-lg">
      <q-card dark bordered class="col" style="min-width:130px">
        <q-card-section>
          <div class="text-caption text-secondary">Total Entries</div>
          <div class="text-h5 text-weight-bold">{{ fmt(summary.total) }}</div>
        </q-card-section>
      </q-card>
      <q-card dark bordered class="col" style="min-width:130px">
        <q-card-section>
          <div class="text-caption text-secondary">Errors</div>
          <div class="text-h5 text-weight-bold text-negative">{{ fmt(errorCount) }}</div>
        </q-card-section>
      </q-card>
      <q-card dark bordered class="col" style="min-width:130px">
        <q-card-section>
          <div class="text-caption text-secondary">Warnings</div>
          <div class="text-h5 text-weight-bold text-warning">{{ fmt(warnCount) }}</div>
        </q-card-section>
      </q-card>
      <q-card dark bordered class="col-auto">
        <q-card-section>
          <div class="text-caption text-secondary">Date Range</div>
          <div class="text-body2">{{ fmtTs(summary.earliest) }}</div>
          <div class="text-caption text-secondary">→ {{ fmtTs(summary.latest) }}</div>
        </q-card-section>
      </q-card>
    </div>

    <q-card dark bordered class="q-mb-md">
      <q-card-section>
        <div class="row items-center q-gutter-sm q-mb-sm">
          <span class="text-subtitle1">Log Volume Over Time</span>
          <q-btn-toggle
            v-model="interval"
            dense
            flat
            :options="[
              { label: 'Min', value: 'minute' },
              { label: 'Hour', value: 'hour' },
              { label: 'Day', value: 'day' },
            ]"
            @update:model-value="loadTimeline"
          />
          <q-btn-toggle
            v-model="stacked"
            dense
            flat
            :options="[
              { label: 'Total', value: false },
              { label: 'Stacked', value: true },
            ]"
            @update:model-value="loadTimeline"
          />
          <q-btn-toggle
            v-model="chartType"
            dense
            flat
            :options="[
              { label: 'Bar', value: 'bar' },
              { label: 'Line', value: 'area' },
            ]"
            @update:model-value="loadTimeline"
          />
        </div>
        <TimelineChart
          :series="timelineSeries"
          :labels="timelineLabels"
          :type="chartType"
          :loading="loadingTimeline"
        />
      </q-card-section>
    </q-card>

    <q-card dark bordered>
      <q-card-section>
        <div class="text-subtitle1 q-mb-sm">Level Distribution</div>
        <LevelChart :levels="levels" :loading="loadingLevels" />
      </q-card-section>
    </q-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { api } from '../api'
import type { LevelCount, SummaryStats, TimelineBucket, TimelineStackedBucket } from '../api/types'
import { useAppStore } from '../stores/appStore'
import LevelChart from './LevelChart.vue'
import TimelineChart from './TimelineChart.vue'

const store = useAppStore()

const today = new Date().toISOString().slice(0, 10)
const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
const from = ref(thirtyDaysAgo)
const to = ref(today)
const level = ref('ALL')
const interval = ref('day')
const stacked = ref(false)
const chartType = ref<'bar' | 'area'>('bar')

const levelOptions = ['ALL', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].map((l) => ({
  label: l,
  value: l,
}))

const summary = ref<SummaryStats>({ total: 0, earliest: null, latest: null })
const levels = ref<LevelCount[]>([])
const timelineSeries = ref<{ name: string; data: number[] }[]>([])
const timelineLabels = ref<string[]>([])
const loadingTimeline = ref(false)
const loadingLevels = ref(false)

const errorCount = computed(() => levels.value.find((l) => l.level === 'ERROR')?.count ?? 0)
const warnCount = computed(() => levels.value.find((l) => l.level === 'WARN')?.count ?? 0)

function fmt(n: number | null) {
  return (n ?? 0).toLocaleString()
}
function fmtTs(iso: string | null) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' })
}

function filters() {
  return {
    file: store.selectedFile || undefined,
    from: from.value || undefined,
    to: to.value || undefined,
    level: level.value !== 'ALL' ? level.value : undefined,
  }
}

async function loadSummary() {
  try {
    summary.value = await api.summary(filters())
  } catch {}
}

async function loadLevels() {
  loadingLevels.value = true
  try {
    levels.value = await api.levels(filters())
  } catch {}
  finally {
    loadingLevels.value = false
  }
}

async function loadTimeline() {
  loadingTimeline.value = true
  try {
    if (stacked.value) {
      const rows: TimelineStackedBucket[] = await api.timelineStacked({
        ...filters(),
        interval: interval.value,
      })
      const buckets = [...new Set(rows.map((r) => r.bucket))].sort()
      const levelSet = [...new Set(rows.map((r) => r.level))].sort()
      const map: Record<string, Record<string, number>> = {}
      rows.forEach((r) => {
        if (!map[r.bucket]) map[r.bucket] = {}
        map[r.bucket][r.level] = r.count
      })
      timelineLabels.value = buckets
      timelineSeries.value = levelSet.map((lvl) => ({
        name: lvl,
        data: buckets.map((b) => map[b]?.[lvl] ?? 0),
      }))
    } else {
      const rows: TimelineBucket[] = await api.timeline({
        ...filters(),
        interval: interval.value,
      })
      timelineLabels.value = rows.map((r) => r.bucket)
      timelineSeries.value = [{ name: 'Logs', data: rows.map((r) => r.count) }]
    }
  } catch {}
  finally {
    loadingTimeline.value = false
  }
}

async function loadAll() {
  await Promise.all([loadSummary(), loadLevels(), loadTimeline()])
}

function reset() {
  from.value = thirtyDaysAgo
  to.value = today
  level.value = 'ALL'
  void loadAll()
}

watch(() => store.selectedFile, () => loadAll())
onMounted(() => loadAll())
</script>
