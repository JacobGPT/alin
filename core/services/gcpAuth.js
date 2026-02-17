/**
 * GCP Authentication Helper
 *
 * Generates OAuth2 access tokens from the service account JSON key.
 * Used by: Vertex AI (Gemini, Veo, Imagen), Cloud TTS, Cloud STT.
 *
 * The service account JSON is stored as an env var (not a file) because
 * Railway doesn't support file-based credentials.
 */

import { createSign } from 'crypto';

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get an OAuth2 access token for Google Cloud APIs.
 * Caches the token and auto-refreshes when expired.
 */
export async function getGCPAccessToken() {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credentialsJson) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON not configured');
  }

  let creds;
  try {
    creds = JSON.parse(credentialsJson);
  } catch {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON');
  }

  // Create JWT for token exchange
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signInput = `${encodedHeader}.${encodedPayload}`;

  const sign = createSign('RSA-SHA256');
  sign.update(signInput);
  const signature = sign.sign(creds.private_key, 'base64url');

  const jwt = `${signInput}.${signature}`;

  // Exchange JWT for access token
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GCP token exchange failed: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);

  return cachedToken;
}

/**
 * Get project ID from env or credentials.
 */
export function getProjectId() {
  return process.env.GCP_PROJECT_ID || 'gen-lang-client-0912844137';
}

/**
 * Get location for Vertex AI.
 */
export function getLocation() {
  return process.env.GCP_LOCATION || 'us-central1';
}
