import Store from 'electron-store';
import { safeStorage } from 'electron';

export interface Preferences {
  selectedInstitution: 'INSTITUTION_A' | 'INSTITUTION_B' | null;
  selectedModelId: string;
  outputStyle: 'concise' | 'detailed' | 'auto';
  autoExpandSources: boolean;
  showConfidenceScores: boolean;
}

interface StoreSchema {
  encryptedAuthToken?: string;
  preferences: Preferences;
}

const VALID_MODEL_IDS = new Set([
  'claude-opus',
  'claude-sonnet',
  'claude-haiku',
  'gpt-5.2',
  'minimax-m2.5',
  'gemini-3.0',
  'deepseek-r1',
  'kimi-k2.5',
]);

const DEFAULT_MODEL_ID = 'claude-haiku';

function sanitizeModelId(modelId: unknown): string {
  return typeof modelId === 'string' && VALID_MODEL_IDS.has(modelId)
    ? modelId
    : DEFAULT_MODEL_ID;
}

const store = new Store<StoreSchema>({
  name: 'rad-assist-desktop',
  defaults: {
    preferences: {
      selectedInstitution: null,
      selectedModelId: DEFAULT_MODEL_ID,
      outputStyle: 'auto',
      autoExpandSources: false,
      showConfidenceScores: true,
    },
  },
});

export function initStore(): void {
  const currentPreferences = store.get('preferences');
  const sanitizedPreferences = {
    ...currentPreferences,
    selectedModelId: sanitizeModelId(currentPreferences?.selectedModelId),
  };
  if (sanitizedPreferences.selectedModelId !== currentPreferences.selectedModelId) {
    store.set('preferences', sanitizedPreferences);
  }

  console.log('Store initialized at:', store.path);
}

/**
 * Get the stored auth token (decrypted from OS keychain)
 */
export function getAuthToken(): string | null {
  try {
    const encrypted = store.get('encryptedAuthToken');
    if (!encrypted) return null;

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('safeStorage encryption not available');
      return null;
    }

    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  } catch (error) {
    console.error('Failed to decrypt auth token:', error);
    return null;
  }
}

/**
 * Store auth token encrypted in OS keychain
 */
export function setAuthToken(token: string): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('safeStorage encryption not available');
      return false;
    }

    const encrypted = safeStorage.encryptString(token);
    store.set('encryptedAuthToken', encrypted.toString('base64'));
    return true;
  } catch (error) {
    console.error('Failed to encrypt auth token:', error);
    return false;
  }
}

/**
 * Clear the stored auth token
 */
export function clearAuthToken(): void {
  store.delete('encryptedAuthToken');
}

/**
 * Check if encryption is available (OS keychain access)
 */
export function canEncrypt(): boolean {
  return safeStorage.isEncryptionAvailable();
}

/**
 * Get user preferences
 */
export function getPreferences(): Preferences {
  const currentPreferences = store.get('preferences');
  const sanitizedPreferences = {
    ...currentPreferences,
    selectedModelId: sanitizeModelId(currentPreferences?.selectedModelId),
  };

  if (sanitizedPreferences.selectedModelId !== currentPreferences.selectedModelId) {
    store.set('preferences', sanitizedPreferences);
  }

  return sanitizedPreferences;
}

/**
 * Update user preferences (partial update supported)
 */
export function setPreferences(updates: Partial<Preferences>): void {
  const current = store.get('preferences');
  const merged = { ...current, ...updates };
  store.set('preferences', {
    ...merged,
    selectedModelId: sanitizeModelId(merged.selectedModelId),
  });
}

/**
 * Reset preferences to defaults
 */
export function resetPreferences(): void {
  store.set('preferences', {
    selectedInstitution: null,
    selectedModelId: DEFAULT_MODEL_ID,
    outputStyle: 'auto',
    autoExpandSources: false,
    showConfidenceScores: true,
  });
}
