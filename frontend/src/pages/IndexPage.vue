<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-dark-page">
      <q-toolbar>
        <q-toolbar-title class="text-weight-bold" style="font-size: 16px">
          File Logger
        </q-toolbar-title>

        <div class="row items-center q-gutter-sm">
          <q-select
            v-model="store.selectedFile"
            :options="fileOptions"
            emit-value
            map-options
            dense
            outlined
            clearable
            placeholder="All files"
            style="min-width: 220px"
            dark
            @update:model-value="store.selectFile(store.selectedFile ?? '')"
          />

          <q-btn
            v-if="store.selectedFile"
            icon="download"
            flat
            round
            dense
            title="Download log file"
            @click="download"
          />

          <q-btn :loading="ingesting" label="Ingest" icon="sync" flat dense @click="ingest" />

          <q-chip outline color="primary" icon="storage">
            {{ fmt(store.totalEntries) }} entries
          </q-chip>
        </div>
      </q-toolbar>

      <q-tabs v-model="tab" dense align="left" class="bg-dark-page">
        <q-tab name="dashboard" label="Dashboard" />
        <q-tab name="logs" label="Logs" />
        <q-tab name="charts" label="Charts" />
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
import { Notify } from 'quasar'
import { computed, onMounted, ref } from 'vue'

import { api } from '../api'
import ChartsTab from '../components/ChartsTab.vue'
import DashboardTab from '../components/DashboardTab.vue'
import LogsTab from '../components/LogsTab.vue'
import { useAppStore } from '../stores/appStore'

const store = useAppStore()
const tab = ref('dashboard')
const ingesting = ref(false)

const fileOptions = computed(() => [
  { label: 'All files', value: '' },
  ...store.files.map((f) => ({ label: f, value: f })),
])

function fmt(n: number) {
  return n.toLocaleString()
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
      Notify.create({ type: 'positive', message: `Ingested ${fmt(result.totalInserted)} new rows` })
      await Promise.all([store.fetchStatus(), store.fetchFiles()])
    } else {
      Notify.create({ type: 'negative', message: result.error ?? 'Ingest failed' })
    }
  } catch (e) {
    Notify.create({ type: 'negative', message: String(e) })
  } finally {
    ingesting.value = false
  }
}

onMounted(async () => {
  const urlFile = new URLSearchParams(window.location.search).get('file') ?? ''
  if (urlFile) store.selectedFile = urlFile
  await Promise.all([store.fetchStatus(), store.fetchFiles()])
})
</script>
