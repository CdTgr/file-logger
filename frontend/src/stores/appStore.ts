import { defineStore } from 'pinia'
import { ref } from 'vue'

import { api } from '../api'

export const useAppStore = defineStore('app', () => {
  const selectedFile = ref('')
  const files = ref<string[]>([])
  const dbReady = ref(false)
  const totalEntries = ref(0)

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

  return { selectedFile, files, dbReady, totalEntries, fetchStatus, fetchFiles, selectFile }
})
