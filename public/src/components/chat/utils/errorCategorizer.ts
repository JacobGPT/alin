/**
 * Error Categorization Utility
 *
 * Extracted from InputArea.tsx — maps raw API/network errors
 * to user-friendly messages.
 */

// ============================================================================
// ERROR CATEGORIZATION
// ============================================================================

export function categorizeError(error: any): string {
  const msg = error?.message || String(error);
  const status = error?.status || error?.response?.status;

  if (status === 401 || msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Invalid or expired token'))
    return 'Session expired. Please log in again.';
  if (status === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit'))
    return 'Rate limit reached. Please wait a moment before sending another message.';
  if (status === 403 || msg.includes('403') || msg.includes('Forbidden'))
    return 'Access denied. This feature may not be available on your plan.';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION'))
    return "Can't reach the server. Check your connection and make sure the backend is running.";
  if (msg.includes('API key') || msg.includes('api_key') || msg.includes('invalid_api_key'))
    return 'API key error. Please check your API key configuration in Settings.';
  if (status === 413 || msg.includes('too large') || msg.includes('payload'))
    return 'Message too large. Try shortening your message or reducing attachments.';
  if (msg.includes('timeout') || msg.includes('Timeout'))
    return 'Request timed out. The server may be busy — try again.';

  return `Error: ${msg}`;
}
