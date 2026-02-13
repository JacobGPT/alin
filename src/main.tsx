/**
 * Main Entry Point - React 18 with Concurrent Features
 *
 * Initializes the React application with:
 * - React Query for server state
 * - Error boundary
 * - Router
 * - Theme provider
 */

// Enable Immer MapSet plugin (must be called before any store initialization)
import { enableMapSet } from 'immer';
enableMapSet();

// ============================================================================
// PRODUCT REGISTRATION & CONTEXT (must happen before any store/engine code)
// ============================================================================
import { registerSitesProduct } from './products/sites';
import { setRequestContext, getRequestContext } from './alin-executive/requestContext';
import { setProjectProvider } from './api/dbService';

// 1. Set initial context from persisted auth (display only — server uses JWT)
const authRaw = localStorage.getItem('alin-auth-storage');
const userId = authRaw ? (() => { try { return JSON.parse(authRaw)?.state?.user?.id; } catch { return undefined; } })() : undefined;
setRequestContext({ userId: userId || 'local-user', projectId: 'default' });

// 2. Wire kernel DB adapter to executive context (DI — no kernel→executive import)
setProjectProvider(() => getRequestContext().projectId);

// 3. Register products (idempotent — safe for HMR)
registerSitesProduct();

// ============================================================================

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ErrorBoundary } from 'react-error-boundary';

import App from './App';
import './styles/globals.css';

// ============================================================================
// REACT QUERY CONFIGURATION
// ============================================================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time: how long data is considered fresh
      staleTime: 5 * 60 * 1000, // 5 minutes
      
      // Cache time: how long inactive data stays in cache
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      
      // Retry configuration
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error instanceof Error && 'status' in error) {
          const status = (error as { status?: number }).status;
          if (status && status >= 400 && status < 500) {
            return false;
          }
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      
      // Refetch configuration
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: false,
    },
    mutations: {
      retry: false, // Don't retry mutations by default
    },
  },
});

// ============================================================================
// ERROR FALLBACK COMPONENT
// ============================================================================

interface ErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

function ErrorFallback({ error, resetErrorBoundary }: ErrorFallbackProps) {
  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-background-primary p-8"
    >
      <div className="max-w-md space-y-6 rounded-xl bg-background-secondary p-8 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-semantic-error-bg">
            <svg
              className="h-6 w-6 text-semantic-error"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-text-primary">
            Something went wrong
          </h1>
        </div>
        
        <div className="rounded-lg bg-background-tertiary p-4">
          <p className="font-mono text-sm text-text-secondary">
            {error.message}
          </p>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={resetErrorBoundary}
            className="flex-1 rounded-lg bg-brand-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-brand-primary-hover"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex-1 rounded-lg border border-border-primary bg-background-tertiary px-4 py-2.5 font-medium text-text-primary transition-colors hover:bg-background-elevated"
          >
            Reload page
          </button>
        </div>
        
        <details className="text-sm text-text-tertiary">
          <summary className="cursor-pointer select-none font-medium">
            Technical details
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-background-primary p-3 text-xs">
            {error.stack}
          </pre>
        </details>
      </div>
    </div>
  );
}

// ============================================================================
// ERROR HANDLER
// ============================================================================

function handleError(error: Error, info: React.ErrorInfo) {
  // Log to error reporting service (Sentry, etc.)
  console.error('Error caught by boundary:', error, info);
  
  // Store error for debugging
  const errorInfo = {
    error: error.message,
    stack: error.stack,
    componentStack: info.componentStack,
    timestamp: Date.now(),
  };
  
  try {
    localStorage.setItem('alin-last-error', JSON.stringify(errorInfo));
  } catch (e) {
    // Ignore storage errors
  }
}

// ============================================================================
// ROOT RENDER
// ============================================================================

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={handleError}
      onReset={() => {
        // Clear error state
        localStorage.removeItem('alin-last-error');
        
        // Reset React Query cache
        queryClient.clear();
        
        // Optionally navigate to home
        window.location.href = '/app';
      }}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
          <App />
        </BrowserRouter>
        
        {/* React Query DevTools - only in development */}
        {import.meta.env.DEV && (
          <ReactQueryDevtools
            initialIsOpen={false}
            position={"bottom-right" as any}
          />
        )}
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// ============================================================================
// HOT MODULE REPLACEMENT (Development Only)
// ============================================================================

if (import.meta.hot) {
  import.meta.hot.accept();
}

// ============================================================================
// PERFORMANCE MONITORING
// ============================================================================

// Log performance metrics
if (import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    
    if (perfData) {
      const metrics = {
        dns: perfData.domainLookupEnd - perfData.domainLookupStart,
        tcp: perfData.connectEnd - perfData.connectStart,
        ttfb: perfData.responseStart - perfData.requestStart,
        download: perfData.responseEnd - perfData.responseStart,
        domInteractive: perfData.domInteractive - perfData.fetchStart,
        domComplete: perfData.domComplete - perfData.fetchStart,
        loadComplete: perfData.loadEventEnd - perfData.fetchStart,
      };
      
      console.log('Performance metrics:', metrics);
      
      // Send to analytics service
      // analytics.track('page_performance', metrics);
    }
  });
}

// ============================================================================
// OFFLINE DETECTION
// ============================================================================

window.addEventListener('online', () => {
  console.log('Connection restored');
  queryClient.refetchQueries();
});

window.addEventListener('offline', () => {
  console.log('Connection lost');
});

// ============================================================================
// UNHANDLED PROMISE REJECTION
// ============================================================================

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  
  // Prevent default browser handling
  event.preventDefault();
  
  // Log to error service
  // Sentry.captureException(event.reason);
});
