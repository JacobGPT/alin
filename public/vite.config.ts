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
  // Vite public assets directory — absolute path so it resolves correctly
  // regardless of CWD (npm workspace scripts may run from project root)
  publicDir: path.resolve(__dirname, 'static'),
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
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
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
    dedupe: ['react', 'react-dom', 'react-router-dom'],
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
    // Set API_PORT env var to override (e.g. API_PORT=3001 for private backend)
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT || 3002}`,
        changeOrigin: true,
        secure: false,
        ws: true // WebSocket support
      },
      '/ws': {
        target: `ws://localhost:${process.env.API_PORT || 3002}`,
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
    outDir: path.resolve(__dirname, 'dist'),
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
    
    // Code splitting: use function-based manualChunks to avoid circular
    // chunk dependencies (object form caused react-vendor ↔ ui-vendor cycle)
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // React core — must be isolated to prevent circular imports
          if (id.includes('/react-dom/') || id.includes('/react-dom@'))
            return 'react-vendor';
          if (id.includes('/react/') || id.includes('/react@'))
            return 'react-vendor';
          if (id.includes('/react-router'))
            return 'react-vendor';
          if (id.includes('/scheduler/') || id.includes('/scheduler@'))
            return 'react-vendor';
          // Heavy libs that are lazy-loaded get their own chunks
          if (id.includes('monaco-editor'))
            return 'monaco-vendor';
          if (id.includes('/three/') || id.includes('@react-three'))
            return '3d-vendor';
          if (id.includes('mermaid'))
            return 'mermaid-vendor';
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
