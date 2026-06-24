<template>
  <div style="min-height: 230px" class="row items-center justify-center">
    <q-spinner v-if="loading" size="48px" color="primary" />
    <div v-else-if="!data.length" class="text-secondary">No HTTP data</div>
    <ApexChart
      v-else
      :key="$q.dark.isActive ? 'd' : 'l'"
      type="donut"
      width="100%"
      height="220"
      :options="options"
      :series="series"
    />
  </div>
</template>

<script setup lang="ts">
import { useQuasar } from 'quasar'
import { computed } from 'vue'

import type { HttpStatusStat } from '../api/types'

const props = defineProps<{ data: HttpStatusStat[]; loading?: boolean }>()
const $q = useQuasar()

const COLORS: Record<string, string> = {
  '1xx': '#8E8E93',
  '2xx': '#30D158',
  '3xx': '#64D2FF',
  '4xx': '#FFD60A',
  '5xx': '#FF453A',
}

const series = computed(() => props.data.map((r) => r.count))
const options = computed(() => {
  const dark = $q.dark.isActive
  return {
    chart: { background: 'transparent', animations: { enabled: false } },
    theme: { mode: dark ? ('dark' as const) : ('light' as const) },
    labels: props.data.map((r) => r.group_label),
    colors: props.data.map((r) => COLORS[r.group_label] ?? '#ff33d6'),
    legend: { labels: { colors: dark ? '#ddd' : '#333' } },
    tooltip: { theme: dark ? ('dark' as const) : ('light' as const) },
    dataLabels: { style: { colors: [dark ? '#1D1D1D' : '#fff'] } },
  }
})
</script>
