<template>
  <div style="min-height: 230px" class="row items-center justify-center">
    <q-spinner v-if="loading" size="48px" color="primary" />
    <div v-else-if="!levels.length" class="text-secondary">No data</div>
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

import type { LevelCount } from '../api/types'

const props = defineProps<{ levels: LevelCount[]; loading?: boolean }>()
const $q = useQuasar()

const COLORS: Record<string, string> = {
  INFO: '#30D158',
  DEBUG: '#64D2FF',
  WARN: '#FFD60A',
  ERROR: '#FF453A',
  FATAL: '#BF5AF2',
  TRACE: '#8E8E93',
}

const series = computed(() => props.levels.map((l) => l.count))
const options = computed(() => {
  const dark = $q.dark.isActive
  return {
    chart: { background: 'transparent', animations: { enabled: false } },
    theme: { mode: dark ? ('dark' as const) : ('light' as const) },
    labels: props.levels.map((l) => l.level),
    colors: props.levels.map((l) => COLORS[l.level] ?? '#ff33d6'),
    legend: { labels: { colors: dark ? '#ddd' : '#333' } },
    tooltip: { theme: dark ? ('dark' as const) : ('light' as const) },
    dataLabels: { style: { colors: [dark ? '#1D1D1D' : '#fff'] } },
  }
})
</script>
