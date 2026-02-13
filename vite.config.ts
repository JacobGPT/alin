import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';
import compression from 'vite-plugin-compression';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  // Dev: base '/' so you just go to localhost:3000
  // Build: base '/' so the backend serves it at /app/
  base: command === 'serve' ? '/' : '/app/',
  plugins: [
    // React with SWC for ultra-fast refresh
    react(),
    
    // PWA support - Only in dev (disabled in prod until icons are added)
    ...(command === 'serve' ? [VitePWA({
      registerType: 'autoUpdate',
      selfDestroying: true,
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'ALIN - AI Operating System',
        short_name: 'ALIN',
        description: 'Advanced Linguistic Intelligence Network - Production AI OS',
        theme_color: '#6366f1',
        background_color: '#0a0a0f',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        categories: ['productivity', 'utilities', 'education'],
        shortcuts: [
          {
            name: 'New Chat',
            url: '/chat/new',
            description: 'Start a new conversation'
          },
          {
            name: 'Website Sprint',
            url: '/tbwo/website-sprint',
            description: 'Launch Website Sprint TBWO'
          },
          {
            name: 'Memory Dashboard',
            url: '/memory',
            description: 'View ALIN memory system'
          }
        ]
      },
      workbox: {
        // Cache strategies
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.openai\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'openai-api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 // 1 hour
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/api\.anthropic\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'claude-api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60
              }
            }
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
              }
            }
          },
          {
            urlPattern: /\.(?:woff|woff2|ttf|otf)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 365 * 24 * 60 * 60 // 1 year
              }
            }
          }
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 // 5MB
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })] : []),
    
    // Brotli + Gzip compression for production
    compression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 10240, // Only compress files > 10KB
      deleteOriginFile: false
    }),
    compression({
      algorithm: 'gzip',
      ext: '.gz'
    })
  ],
  
  // Path resolution - Absolute imports
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@store': path.resolve(__dirname, './src/store'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@api': path.resolve(__dirname, './src/api'),
      '@db': path.resolve(__dirname, './src/db'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@tools': path.resolve(__dirname, './src/tools'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@kernel': path.resolve(__dirname, './src/alin-kernel'),
      '@executive': path.resolve(__dirname, './src/alin-executive'),
      '@memory': path.resolve(__dirname, './src/alin-memory'),
      '@surface': path.resolve(__dirname, './src/alin-surface'),
      '@products': path.resolve(__dirname, './src/products')
    }
  },
  
  // Server configuration
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    open: true,
    cors: true,
    // Proxy API requests to backend during development
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
        ws: true // WebSocket support
      },
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true
      }
    }
  },
  
  // Preview server (production preview)
  preview: {
    port: 3000,
    strictPort: true,
    host: true,
    open: true
  },
  
  // Build optimization
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log in production
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info']
      },
      format: {
        comments: false
      }
    },
    
    // Code splitting strategy for optimal loading
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          
          // State management
          'state-vendor': ['zustand', 'immer', '@tanstack/react-query'],
          
          // UI components
          'ui-vendor': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            'framer-motion'
          ],
          
          // 3D visualization
          '3d-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
          
          // Charts and graphs
          'charts-vendor': ['recharts', 'cytoscape', 'react-cytoscapejs'],
          
          // Markdown and code
          'markdown-vendor': [
            'react-markdown',
            'remark-gfm',
            'rehype-katex',
            'highlight.js'
          ],
          
          // Monaco editor (code editor)
          'monaco-vendor': ['monaco-editor', '@monaco-editor/react'],
          
          // Utils
          'utils-vendor': [
            'date-fns',
            'lodash-es',
            'uuid',
            'nanoid',
            'zod'
          ]
        }
      }
    },
    
    // Chunk size warnings
    chunkSizeWarningLimit: 1000,
    
    // Reduce bundle size
    cssCodeSplit: true,
    assetsInlineLimit: 4096, // Inline assets < 4KB as base64
    
    // Generate manifest for deployment
    manifest: true
  },
  
  // Performance optimizations
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'zustand',
      '@tanstack/react-query',
      'framer-motion'
    ],
    exclude: ['@react-three/fiber'] // Don't pre-bundle heavy deps
  },
  
  // Environment variables
  envPrefix: 'VITE_',
  
  // Enable esbuild for faster builds
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
    legalComments: 'none'
  }
}));
