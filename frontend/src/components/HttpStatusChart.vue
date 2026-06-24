<template>
  <div style="min-height: 230px" class="row items-center justify-center">
    <q-spinner v-if="loading" size="48px" color="primary" />
    <div v-else-if="!data.length" class="text-secondary">No HTTP data</div>
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

import type { HttpStatusStat } from '../api/types'

const props = defineProps<{ data: HttpStatusStat[]; loading?: boolean }>()

const COLORS: Record<string, string> = {
  '1xx': '#aaaaaa',
  '2xx': '#21BA45',
  '3xx': '#31CCEC',
  '4xx': '#F2C037',
  '5xx': '#ff4d63',
}

const series = computed(() => props.data.map((r) => r.count))
const options = computed(() => ({
  chart: { background: 'transparent', animations: { enabled: false } },
  theme: { mode: 'dark' as const },
  labels: props.data.map((r) => r.group_label),
  colors: props.data.map((r) => COLORS[r.group_label] ?? '#ff33d6'),
  legend: { labels: { colors: '#ddd' } },
  tooltip: { theme: 'dark' as const },
  dataLabels: { style: { colors: ['#1D1D1D'] } },
}))
</script>
