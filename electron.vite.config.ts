import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@kairo/api': resolve(__dirname, '../kairo-ts/packages/api/src/index.ts'),
        '@kairo/core': resolve(__dirname, '../kairo-ts/packages/core/src/index.ts')
      }
    },
    // The kairo-ts workspace ships TypeScript sources directly via its `main`
    // and `exports` fields. We must bundle them rather than externalize so
    // Vite can transpile them; runtime npm deps (openai, zod, anthropic SDK)
    // remain external and are resolved from node_modules at runtime.
    ssr: {
      noExternal: ['@kairo/api', '@kairo/core']
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          // Split heavy vendors out of the single app chunk. A monolithic ~9MB
          // bundle forces the JS engine to eagerly parse+JIT everything on
          // launch (large RSS); separate chunks parse lazily and cache across
          // releases. monaco-editor is by far the biggest tenant.
          manualChunks(id: string): string | undefined {
            if (!id.includes('node_modules') && !id.includes('kairo-ts')) return undefined
            if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'monaco'
            if (/node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(id)) return 'react-vendor'
            // NOTE: do NOT group shiki — it already code-splits per language into
            // small lazy chunks; merging them produces one giant eager blob.
            if (/(react-markdown|remark|rehype|micromark|mdast|hast|unist|vfile|property-information)/.test(id)) return 'markdown'
            if (id.includes('kairo-ts/packages')) return 'kairo'
            return undefined
          }
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react()]
  }
})
