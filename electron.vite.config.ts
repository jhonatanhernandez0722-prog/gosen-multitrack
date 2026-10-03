import { resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import pkg from './package.json'

// Con varias entradas en main hay que declarar los módulos externos de forma explícita:
// electron, módulos de Node y las dependencias de producción (se cargan desde node_modules).
const external = [
  'electron',
  /^electron\/.+/,
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
  ...Object.keys(pkg.dependencies ?? {})
]

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Autoprueba de integración (npm run selftest). No se incluye en el instalador.
          selftest: resolve(__dirname, 'src/main/selftest.ts')
        },
        external,
        output: { format: 'cjs', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' }
      }
    }
  },
  preload: {},
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // Sin recursos incrustados como data: (fuentes, imágenes): así la CSP no necesita permitir data:.
    build: { assetsInlineLimit: 0 },
    plugins: [react(), productionCsp()]
  }
})

/**
 * CSP estricta solo en producción: en desarrollo, la recarga en caliente de React necesita
 * un script en línea y una conexión WebSocket al servidor de Vite.
 */
function productionCsp(): Plugin {
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'"
  return {
    name: 'gosen-production-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }]
  }
}
