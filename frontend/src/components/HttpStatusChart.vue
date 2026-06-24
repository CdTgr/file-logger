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
  '1xx': '#aaaaaa',
  '2xx': '#21BA45',
  '3xx': '#31CCEC',
  '4xx': '#F2C037',
  '5xx': '#ff4d63',
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
