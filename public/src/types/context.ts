/**
 * RequestContext — represents the current user session context.
 * User identity is ALWAYS derived server-side from JWT.
 * projectId is the only client-supplied scope hint.
 */
export interface RequestContext {
  userId: string;        // Read from auth state (display only — server derives from JWT)
  projectId: string;     // Client-supplied project scope (default: 'default')
  threadId?: string;     // Current conversation ID
  tbwoRunId?: string;    // Current TBWO execution ID
}
