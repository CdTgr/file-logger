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
            icon="sym_o_download"
            label="Download"
            flat
            no-caps
            @click="download"
          />

          <q-btn
            :loading="ingesting"
            label="Ingest"
            icon="sym_o_sync"
            flat
            no-caps
            @click="ingest"
          />

          <q-chip outline color="primary" icon="sym_o_storage">
            {{ fmt(store.totalEntries) }} entries
          </q-chip>

          <q-btn
            :icon="$q.dark.isActive ? 'sym_o_light_mode' : 'sym_o_dark_mode'"
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
        <q-tab
          name="dashboard"
          icon="sym_o_dashboard"
          label="Dashboard"
          no-caps
        />
        <q-tab name="logs" icon="sym_o_list_alt" label="Logs" no-caps />
        <q-tab name="charts" icon="sym_o_bar_chart" label="Charts" no-caps />
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

        <!-- Filter FAB -->
        <q-page-sticky position="bottom-right" :offset="[20, 20]">
          <q-btn
            fab
            icon="sym_o_tune"
            color="primary"
            @click="openFilterDialog"
          />
        </q-page-sticky>
      </q-page>
    </q-page-container>

    <!-- Filter dialog -->
    <q-dialog v-model="filterOpen">
      <q-card style="min-width: 360px; max-width: 95vw">
        <q-card-section class="row items-center no-wrap q-pb-none">
          <q-icon name="sym_o_tune" size="20px" class="q-mr-xs" />
          <span class="text-subtitle1 text-weight-bold">Filters</span>
          <q-space />
          <q-btn icon="sym_o_close" flat round v-close-popup />
        </q-card-section>

        <q-card-section class="column q-gutter-sm q-pt-md">
          <q-input
            v-model="draftFrom"
            outlined
            label="From"
            readonly
            style="width: 100%"
          >
            <template #append>
              <q-icon name="sym_o_event" class="cursor-pointer">
                <q-popup-proxy
                  cover
                  transition-show="scale"
                  transition-hide="scale"
                >
                  <q-date v-model="draftFrom" mask="YYYY-MM-DD">
                    <div class="row items-center justify-end">
                      <q-btn
                        v-close-popup
                        label="Close"
                        color="primary"
                        flat
                        no-caps
                      />
                    </div>
                  </q-date>
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>

          <q-input
            v-model="draftTo"
            outlined
            label="To"
            readonly
            style="width: 100%"
          >
            <template #append>
              <q-icon name="sym_o_event" class="cursor-pointer">
                <q-popup-proxy
                  cover
                  transition-show="scale"
                  transition-hide="scale"
                >
                  <q-date v-model="draftTo" mask="YYYY-MM-DD">
                    <div class="row items-center justify-end">
                      <q-btn
                        v-close-popup
                        label="Close"
                        color="primary"
                        flat
                        no-caps
                      />
                    </div>
                  </q-date>
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>

          <q-select
            v-model="draftLevel"
            :options="levelOptions"
            outlined
            label="Level"
            emit-value
            map-options
            style="width: 100%"
          />

          <q-input
            v-model="draftSearch"
            outlined
            label="Search logs"
            clearable
            style="width: 100%"
          >
            <template #append><q-icon name="sym_o_search" /></template>
          </q-input>
        </q-card-section>

        <q-card-actions align="right" class="q-pa-md q-pt-sm">
          <q-btn label="Reset" flat no-caps @click="resetFilters" />
          <q-btn label="Apply" color="primary" no-caps @click="applyFilters" />
        </q-card-actions>
      </q-card>
    </q-dialog>
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

// File search
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

// Filter dialog
const filterOpen = ref(false)
const draftFrom = ref(store.filterFrom)
const draftTo = ref(store.filterTo)
const draftLevel = ref(store.filterLevel)
const draftSearch = ref(store.filterSearch)

const levelOptions = [
  'ALL',
  'TRACE',
  'DEBUG',
  'INFO',
  'WARN',
  'ERROR',
  'FATAL',
].map((l) => ({ label: l, value: l }))

function openFilterDialog() {
  draftFrom.value = store.filterFrom
  draftTo.value = store.filterTo
  draftLevel.value = store.filterLevel
  draftSearch.value = store.filterSearch
  filterOpen.value = true
}

function applyFilters() {
  store.filterFrom = draftFrom.value
  store.filterTo = draftTo.value
  store.filterLevel = draftLevel.value
  store.filterSearch = draftSearch.value
  filterOpen.value = false
}

function resetFilters() {
  store.resetFilters()
  draftFrom.value = store.filterFrom
  draftTo.value = store.filterTo
  draftLevel.value = store.filterLevel
  draftSearch.value = store.filterSearch
  filterOpen.value = false
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
  if (saved !== null) $q.dark.set(saved === '1')

  const urlFile = new URLSearchParams(window.location.search).get('file') ?? ''
  if (urlFile) store.selectedFile = urlFile
  await Promise.all([store.fetchStatus(), store.fetchFiles()])
})
</script>
