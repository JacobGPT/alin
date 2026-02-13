/**
 * RequestContext — Current user session context
 *
 * Provides a simple getter/setter for the current request context.
 * User identity is ALWAYS derived server-side from JWT — userId here
 * is for display purposes only.
 */

import type { RequestContext } from '../types/context';

let _currentContext: RequestContext = { userId: 'local-user', projectId: 'default' };

export function setRequestContext(ctx: Partial<RequestContext>): void {
  _currentContext = { ..._currentContext, ...ctx };
}

export function getRequestContext(): RequestContext {
  return _currentContext;
}
