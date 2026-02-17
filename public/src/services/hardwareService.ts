/**
 * Hardware Service - Real-time system metrics polling with ring buffer
 */

interface SystemMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    cores: number;
    temperature?: number;
    frequency?: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  gpu?: {
    name: string;
    usage: number;
    memoryUsed: number;
    memoryTotal: number;
    temperature?: number;
    power?: number;
  };
  uptime: number;
  platform: string;
}

type MetricsCallback = (metrics: SystemMetrics) => void;

class HardwareService {
  private buffer: SystemMetrics[] = [];
  private maxBufferSize: number = 60; // 60 data points
  private pollInterval: NodeJS.Timeout | null = null;
  private pollIntervalMs: number = 2000;
  private subscribers: Set<MetricsCallback> = new Set();
  private lastMetrics: SystemMetrics | null = null;
  private backendUrl: string;

  constructor() {
    this.backendUrl = import.meta.env['VITE_BACKEND_URL'] || '';
  }

  private getAuthHeaders(): Record<string, string> {
    try {
      const raw = localStorage.getItem('alin-auth-storage');
      if (raw) {
        const parsed = JSON.parse(raw);
        const token = parsed?.state?.token;
        if (token) return { Authorization: `Bearer ${token}` };
      }
    } catch {}
    return {};
  }

  /**
   * Start polling for metrics
   */
  start(): void {
    if (this.pollInterval) return;

    this.fetchMetrics(); // immediate first fetch
    this.pollInterval = setInterval(() => {
      this.fetchMetrics();
    }, this.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Subscribe to metrics updates
   */
  subscribe(callback: MetricsCallback): () => void {
    this.subscribers.add(callback);
    // Send last known metrics immediately
    if (this.lastMetrics) {
      callback(this.lastMetrics);
    }
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Get the metrics buffer (history)
   */
  getHistory(): SystemMetrics[] {
    return [...this.buffer];
  }

  /**
   * Get latest metrics
   */
  getLatest(): SystemMetrics | null {
    return this.lastMetrics;
  }

  /**
   * Fetch metrics from backend or use browser fallback
   */
  private async fetchMetrics(): Promise<void> {
    let metrics: SystemMetrics;

    try {
      const response = await fetch(`${this.backendUrl}/api/system/metrics`, {
        signal: AbortSignal.timeout(3000),
        headers: this.getAuthHeaders(),
      });

      if (response.ok) {
        metrics = await response.json();
      } else {
        metrics = this.getBrowserMetrics();
      }
    } catch {
      metrics = this.getBrowserMetrics();
    }

    // Add to ring buffer
    this.buffer.push(metrics);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    this.lastMetrics = metrics;

    // Notify subscribers
    this.subscribers.forEach(cb => {
      try { cb(metrics); } catch (e) { console.error('[Hardware] Subscriber error:', e); }
    });
  }

  /**
   * Browser-based metrics fallback (limited)
   * Returns only what the browser can actually report — no fake/random values.
   */
  private getBrowserMetrics(): SystemMetrics {
    const nav = navigator as any;
    const perf = performance as any;
    const memory = perf.memory;

    return {
      timestamp: Date.now(),
      cpu: {
        usage: 0, // Not available in browser — 0 means "not measured"
        cores: nav.hardwareConcurrency || 0,
      },
      memory: {
        total: memory?.jsHeapSizeLimit || 0,
        used: memory?.usedJSHeapSize || 0,
        free: (memory?.jsHeapSizeLimit || 0) - (memory?.usedJSHeapSize || 0),
        usagePercent: memory ? (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100 : 0,
      },
      uptime: performance.now() / 1000,
      platform: nav.platform || 'browser',
    };
  }
}

export const hardwareService = new HardwareService();
export type { SystemMetrics, MetricsCallback };
