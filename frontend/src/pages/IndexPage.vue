<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="app-header">
      <q-toolbar>
        <q-toolbar-title class="text-weight-bold" style="font-size: 16px">
          File Logger
        </q-toolbar-title>

        <div class="row items-center q-gutter-sm">
          <q-select
            v-model="store.selectedFile"
            :options="filteredFileOptions"
            emit-value
            map-options
            outlined
            clearable
            use-input
            input-debounce="0"
            placeholder="All files"
            style="min-width: 240px"
            @filter="filterFiles"
            @update:model-value="store.selectFile(store.selectedFile ?? '')"
          />

          <q-btn
            v-if="store.selectedFile"
            icon="download"
            label="Download"
            flat
            no-caps
            @click="download"
          />

          <q-btn
            :loading="ingesting"
            label="Ingest"
            icon="sync"
            flat
            no-caps
            @click="ingest"
          />

          <q-chip outline color="primary" icon="storage">
            {{ fmt(store.totalEntries) }} entries
          </q-chip>

          <q-btn
            :icon="$q.dark.isActive ? 'light_mode' : 'dark_mode'"
            flat
            round
            :title="
              $q.dark.isActive ? 'Switch to light mode' : 'Switch to dark mode'
            "
            @click="toggleDark"
          />
        </div>
      </q-toolbar>

      <q-tabs v-model="tab" align="left" class="app-header-tabs">
        <q-tab name="dashboard" label="Dashboard" no-caps />
        <q-tab name="logs" label="Logs" no-caps />
        <q-tab name="charts" label="Charts" no-caps />
      </q-tabs>
    </q-header>

    <q-page-container>
      <q-page>
        <q-tab-panels v-model="tab" animated keep-alive>
          <q-tab-panel name="dashboard" class="q-pa-md">
            <DashboardTab />
          </q-tab-panel>
          <q-tab-panel name="logs" class="q-pa-md">
            <LogsTab />
          </q-tab-panel>
          <q-tab-panel name="charts" class="q-pa-md">
            <ChartsTab />
          </q-tab-panel>
        </q-tab-panels>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { useQuasar, Notify } from 'quasar'
import { computed, onMounted, ref } from 'vue'

import { api } from '../api'
import ChartsTab from '../components/ChartsTab.vue'
import DashboardTab from '../components/DashboardTab.vue'
import LogsTab from '../components/LogsTab.vue'
import { useAppStore } from '../stores/appStore'

const $q = useQuasar()
const store = useAppStore()
const tab = ref('dashboard')
const ingesting = ref(false)
const fileSearch = ref('')

const fileOptions = computed(() => [
  { label: 'All files', value: '' },
  ...store.files.map((f) => ({ label: f, value: f })),
])

const filteredFileOptions = ref(fileOptions.value)

function filterFiles(val: string, update: (fn: () => void) => void) {
  update(() => {
    const needle = val.toLowerCase()
    filteredFileOptions.value = needle
      ? fileOptions.value.filter((o) => o.label.toLowerCase().includes(needle))
      : fileOptions.value
  })
}

function fmt(n: number) {
  return n.toLocaleString()
}

function toggleDark() {
  $q.dark.toggle()
  localStorage.setItem('darkMode', $q.dark.isActive ? '1' : '0')
}

function download() {
  if (store.selectedFile) {
    window.location.href = api.downloadUrl(store.selectedFile)
  }
}

async function ingest() {
  ingesting.value = true
  try {
    const result = await api.ingest(false)
    if (result.success) {
      Notify.create({
        type: 'positive',
        message: `Ingested ${fmt(result.totalInserted)} new rows`,
      })
      await Promise.all([store.fetchStatus(), store.fetchFiles()])
    } else {
      Notify.create({
        type: 'negative',
        message: result.error ?? 'Ingest failed',
      })
    }
  } catch (e) {
    Notify.create({ type: 'negative', message: String(e) })
  } finally {
    ingesting.value = false
  }
}

onMounted(async () => {
  const saved = localStorage.getItem('darkMode')
  if (saved !== null) {
    $q.dark.set(saved === '1')
  }

  const urlFile = new URLSearchParams(window.location.search).get('file') ?? ''
  if (urlFile) store.selectedFile = urlFile
  await Promise.all([store.fetchStatus(), store.fetchFiles()])
})
</script>
