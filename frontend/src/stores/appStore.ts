import { defineStore } from 'pinia'
import { ref } from 'vue'

import { api } from '../api'

const todayStr = () => new Date().toISOString().slice(0, 10)
const thirtyAgoStr = () =>
  new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

export const useAppStore = defineStore('app', () => {
  const selectedFile = ref('')
  const files = ref<string[]>([])
  const dbReady = ref(false)
  const totalEntries = ref(0)

  // Shared filter state — consumed by all three tabs
  const filterFrom = ref(thirtyAgoStr())
  const filterTo = ref(todayStr())
  const filterLevel = ref('ALL')
  const filterSearch = ref('')

  async function fetchStatus() {
    try {
      const s = await api.status()
      dbReady.value = s.ready
      totalEntries.value = s.total ?? 0
    } catch {
      dbReady.value = false
    }
  }

  async function fetchFiles() {
    try {
      files.value = await api.files()
    } catch {}
  }

  function selectFile(f: string) {
    selectedFile.value = f
    const url = new URL(window.location.href)
    if (f) url.searchParams.set('file', f)
    else url.searchParams.delete('file')
    history.pushState({}, '', url)
  }

  function resetFilters() {
    filterFrom.value = thirtyAgoStr()
    filterTo.value = todayStr()
    filterLevel.value = 'ALL'
    filterSearch.value = ''
  }

  return {
    selectedFile,
    files,
    dbReady,
    totalEntries,
    filterFrom,
    filterTo,
    filterLevel,
    filterSearch,
    fetchStatus,
    fetchFiles,
    selectFile,
    resetFilters,
  }
})
