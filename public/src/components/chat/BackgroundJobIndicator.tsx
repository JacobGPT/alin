/**
 * BackgroundJobIndicator - Shows background job status in chat header
 *
 * Displays a bell icon with unread count badge. Click opens a dropdown
 * showing active/recent jobs and notifications.
 */

import { useState, useRef, useEffect } from 'react';
import {
  BellIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowPathIcon,
  XMarkIcon,
  QueueListIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { useBackgroundStore, type BackgroundJob, type JobNotification } from '../../store/backgroundStore';

export function BackgroundJobIndicator() {
  const jobs = useBackgroundStore((s) => s.jobs);
  const notifications = useBackgroundStore((s) => s.notifications);
  const unreadCount = useBackgroundStore((s) => s.getUnreadCount());
  const activeJobs = useBackgroundStore((s) => s.getActiveJobs());
  const markAllRead = useBackgroundStore((s) => s.markAllRead);
  const clearCompleted = useBackgroundStore((s) => s.clearCompleted);
  const clearNotifications = useBackgroundStore((s) => s.clearNotifications);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'jobs' | 'notifications'>('jobs');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Request browser notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const handleToggle = () => {
    setOpen(!open);
    if (!open && unreadCount > 0) {
      markAllRead();
    }
  };

  const hasActivity = activeJobs.length > 0 || unreadCount > 0;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className={`relative rounded p-1.5 transition-colors ${
          hasActivity
            ? 'text-brand-primary hover:bg-brand-primary/10'
            : 'text-text-tertiary hover:bg-background-hover hover:text-text-primary'
        }`}
        title={activeJobs.length > 0 ? `${activeJobs.length} active job(s)` : 'Background jobs'}
      >
        {activeJobs.length > 0 ? (
          <ArrowPathIcon className="h-5 w-5 animate-spin" />
        ) : (
          <BellIcon className="h-5 w-5" />
        )}

        {/* Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-border-primary bg-background-elevated shadow-xl z-50">
          {/* Tabs */}
          <div className="flex border-b border-border-primary">
            <button
              onClick={() => setTab('jobs')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                tab === 'jobs'
                  ? 'text-brand-primary border-b-2 border-brand-primary'
                  : 'text-text-tertiary hover:text-text-primary'
              }`}
            >
              Jobs {activeJobs.length > 0 && `(${activeJobs.length})`}
            </button>
            <button
              onClick={() => setTab('notifications')}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                tab === 'notifications'
                  ? 'text-brand-primary border-b-2 border-brand-primary'
                  : 'text-text-tertiary hover:text-text-primary'
              }`}
            >
              Notifications {notifications.length > 0 && `(${notifications.length})`}
            </button>
          </div>

          {/* Content */}
          <div className="max-h-72 overflow-y-auto">
            {tab === 'jobs' ? (
              <JobsList jobs={jobs} />
            ) : (
              <NotificationsList notifications={notifications} />
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border-primary px-3 py-1.5">
            {tab === 'jobs' ? (
              <button
                onClick={clearCompleted}
                className="text-[10px] text-text-quaternary hover:text-text-primary transition-colors"
              >
                Clear completed
              </button>
            ) : (
              <button
                onClick={clearNotifications}
                className="text-[10px] text-text-quaternary hover:text-text-primary transition-colors"
              >
                Clear all
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-0.5 rounded text-text-quaternary hover:text-text-primary"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// JOBS LIST
// ============================================================================

function JobsList({ jobs }: { jobs: BackgroundJob[] }) {
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <QueueListIcon className="h-8 w-8 text-text-quaternary mb-2" />
        <p className="text-xs text-text-quaternary">No background jobs</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-primary">
      {jobs.slice(0, 20).map((job) => (
        <JobItem key={job.id} job={job} />
      ))}
    </div>
  );
}

function JobItem({ job }: { job: BackgroundJob }) {
  const cancelJob = useBackgroundStore((s) => s.cancelJob);
  const removeJob = useBackgroundStore((s) => s.removeJob);

  const statusIcon = {
    queued: <ClockIcon className="h-3.5 w-3.5 text-text-quaternary" />,
    running: <ArrowPathIcon className="h-3.5 w-3.5 text-blue-400 animate-spin" />,
    completed: <CheckCircleIcon className="h-3.5 w-3.5 text-green-400" />,
    failed: <ExclamationCircleIcon className="h-3.5 w-3.5 text-red-400" />,
    cancelled: <XMarkIcon className="h-3.5 w-3.5 text-text-quaternary" />,
  }[job.status];

  const elapsed = job.completedAt
    ? Math.round((job.completedAt - (job.startedAt || job.createdAt)) / 1000)
    : job.startedAt
      ? Math.round((Date.now() - job.startedAt) / 1000)
      : 0;

  return (
    <div className="px-3 py-2 hover:bg-background-hover/50 transition-colors">
      <div className="flex items-center gap-2">
        {statusIcon}
        <span className="text-xs font-medium text-text-primary truncate flex-1">
          {job.title}
        </span>
        {(job.status === 'running' || job.status === 'queued') && (
          <button
            onClick={() => cancelJob(job.id)}
            className="text-[10px] text-text-quaternary hover:text-red-400"
          >
            Cancel
          </button>
        )}
        {(job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
          <button
            onClick={() => removeJob(job.id)}
            className="text-[10px] text-text-quaternary hover:text-text-primary"
          >
            Remove
          </button>
        )}
      </div>

      {/* Progress bar for running jobs */}
      {job.status === 'running' && (
        <div className="mt-1 h-1 rounded-full bg-background-tertiary overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-400 transition-all duration-500"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}

      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10px] text-text-quaternary capitalize">{job.type.replace('_', ' ')}</span>
        {elapsed > 0 && (
          <span className="text-[10px] text-text-quaternary">{elapsed}s</span>
        )}
        {job.error && (
          <span className="text-[10px] text-red-400 truncate">{job.error}</span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// NOTIFICATIONS LIST
// ============================================================================

function NotificationsList({ notifications }: { notifications: JobNotification[] }) {
  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <BellIcon className="h-8 w-8 text-text-quaternary mb-2" />
        <p className="text-xs text-text-quaternary">No notifications</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border-primary">
      {notifications.slice(0, 20).map((n) => (
        <div key={n.id} className={`px-3 py-2 ${!n.read ? 'bg-brand-primary/5' : ''}`}>
          <div className="flex items-center gap-2">
            {n.type === 'success' ? (
              <CheckCircleIcon className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
            ) : n.type === 'error' ? (
              <ExclamationCircleIcon className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
            ) : (
              <BellIcon className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
            )}
            <span className="text-xs font-medium text-text-primary truncate">{n.title}</span>
          </div>
          <p className="text-[10px] text-text-tertiary mt-0.5 ml-5">{n.message}</p>
          <span className="text-[10px] text-text-quaternary ml-5">
            {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      ))}
    </div>
  );
}

