<template>
  <div style="min-height: 280px" class="row items-center justify-center">
    <q-spinner v-if="loading" size="48px" color="primary" />
    <div v-else-if="!series.length || !labels.length" class="text-secondary">
      No data
    </div>
    <ApexChart
      v-else
      :key="type + stableKey"
      :type="type"
      width="100%"
      height="260"
      :options="chartOptions"
      :series="series"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  series: { name: string; data: number[] }[]
  labels: string[]
  type: 'bar' | 'area'
  loading?: boolean
}>()

const stableKey = computed(() => props.labels.slice(0, 3).join(','))

const LEVEL_COLORS: Record<string, string> = {
  INFO: '#21BA45',
  DEBUG: '#31CCEC',
  WARN: '#F2C037',
  ERROR: '#ff4d63',
  FATAL: '#ce93d8',
  TRACE: '#aaaaaa',
  Logs: '#ff33d6',
}

const chartOptions = computed(() => ({
  chart: {
    background: 'transparent',
    toolbar: { show: false },
    animations: { enabled: false },
    stacked: props.series.length > 1,
  },
  theme: { mode: 'dark' as const },
  colors: props.series.map((s) => LEVEL_COLORS[s.name] ?? '#ff33d6'),
  xaxis: {
    categories: props.labels,
    labels: {
      style: { colors: '#aaa' },
      rotate: -30,
      maxHeight: 60,
    },
    axisBorder: { color: '#333' },
    axisTicks: { color: '#333' },
  },
  yaxis: { labels: { style: { colors: '#aaa' } } },
  grid: { borderColor: '#2a2a2a' },
  legend: { labels: { colors: '#ddd' } },
  fill: { opacity: props.type === 'area' ? 0.3 : 1 },
  stroke:
    props.type === 'area'
      ? { curve: 'smooth' as const, width: 2 }
      : { show: false },
  tooltip: { theme: 'dark' as const },
  dataLabels: { enabled: false },
}))
</script>
