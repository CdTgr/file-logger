import {
  createMemoryHistory,
  createRouter,
  createWebHashHistory,
} from 'vue-router'

import routes from './routes'

export default createRouter({
  history: process.env.SERVER ? createMemoryHistory() : createWebHashHistory(),
  routes,
})
