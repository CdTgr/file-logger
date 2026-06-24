import { configure } from 'quasar/wrappers'

export default configure(function () {
  return {
    boot: ['pinia', 'apexcharts'],
    css: ['app.scss'],
    extras: ['material-icons'],
    build: {
      target: {
        browser: ['es2019', 'edge88', 'firefox78', 'chrome87', 'safari13.1'],
        node: 'node20',
      },
      typescript: {
        strict: true,
        vueShim: true,
      },
    },
    devServer: {
      open: false,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    framework: {
      config: {
        dark: true,
        notify: { position: 'top-right', timeout: 3000 },
      },
      extras: ['material-icons'],
      plugins: ['Notify', 'Dialog'],
    },
    animations: [],
  }
})
