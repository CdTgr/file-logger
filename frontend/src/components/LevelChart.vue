<template>
  <div style="min-height: 230px" class="row items-center justify-center">
    <q-spinner v-if="loading" size="48px" color="primary" />
    <div v-else-if="!levels.length" class="text-secondary">No data</div>
    <ApexChart
      v-else
      type="donut"
      width="100%"
      height="220"
      :options="options"
      :series="series"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { LevelCount } from '../api/types'

const props = defineProps<{ levels: LevelCount[]; loading?: boolean }>()

const COLORS: Record<string, string> = {
  INFO: '#21BA45',
  DEBUG: '#31CCEC',
  WARN: '#F2C037',
  ERROR: '#ff4d63',
  FATAL: '#ce93d8',
  TRACE: '#aaaaaa',
}

const series = computed(() => props.levels.map((l) => l.count))
const options = computed(() => ({
  chart: { background: 'transparent', animations: { enabled: false } },
  theme: { mode: 'dark' as const },
  labels: props.levels.map((l) => l.level),
  colors: props.levels.map((l) => COLORS[l.level] ?? '#ff33d6'),
  legend: { labels: { colors: '#ddd' } },
  tooltip: { theme: 'dark' as const },
  dataLabels: { style: { colors: ['#1D1D1D'] } },
}))
</script>
