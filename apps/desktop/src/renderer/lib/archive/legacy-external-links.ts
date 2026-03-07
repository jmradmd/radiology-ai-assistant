/**
 * Archived desktop external-link behavior (Feb 2026).
 *
 * This file keeps the previous helper pattern that opened arbitrary URLs
 * from markdown/source citations in the system browser.
 *
 * Runtime policy is now internal-only citations:
 * - Only /api/policies/* links are actionable.
 * - Outbound external links are disabled in chat responses.
 */

import { APP_BASE_URL } from '../constants';

export function legacyOpenAnyUrl(url: string): void {
  window.electron.openExternal(url);
}

export function legacyOpenPolicyWithHost(pathOrUrl: string): void {
  const normalized = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${APP_BASE_URL}${pathOrUrl}`;
  window.electron.openExternal(normalized);
}
