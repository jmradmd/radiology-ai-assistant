import { create } from 'zustand';

type Institution = 'INSTITUTION_A' | 'INSTITUTION_B' | null;
type OutputStyle = 'concise' | 'detailed' | 'auto';
type ModelId =
  | 'claude-opus'
  | 'claude-sonnet'
  | 'claude-haiku'
  | 'gpt-5.2'
  | 'minimax-m2.5'
  | 'gemini-3.0'
  | 'deepseek-r1'
  | 'kimi-k2.5';

const VALID_MODEL_IDS: ReadonlySet<ModelId> = new Set([
  'claude-opus',
  'claude-sonnet',
  'claude-haiku',
  'gpt-5.2',
  'minimax-m2.5',
  'gemini-3.0',
  'deepseek-r1',
  'kimi-k2.5',
]);

function isValidModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && VALID_MODEL_IDS.has(value as ModelId);
}

function normalizeOutputStyle(value: unknown): OutputStyle {
  if (value === 'concise' || value === 'detailed' || value === 'auto') {
    return value;
  }
  if (value === 'explanatory') {
    return 'auto';
  }
  return 'auto';
}

interface PreferencesState {
  selectedInstitution: Institution;
  selectedModelId: ModelId;
  outputStyle: OutputStyle;
  autoExpandSources: boolean;
  showConfidenceScores: boolean;
  isLoaded: boolean;

  // Actions
  loadPreferences: () => Promise<void>;
  setSelectedInstitution: (institution: Institution) => void;
  setSelectedModelId: (id: ModelId) => void;
  setOutputStyle: (style: OutputStyle) => void;
  setAutoExpandSources: (expand: boolean) => void;
  setShowConfidenceScores: (show: boolean) => void;
}

const STORAGE_KEY = 'preferences';

export const usePreferencesStore = create<PreferencesState>((set) => ({
  selectedInstitution: null,
  selectedModelId: 'claude-haiku',
  outputStyle: 'auto',
  autoExpandSources: false,
  showConfidenceScores: true,
  isLoaded: false,

  loadPreferences: async () => {
    try {
      const stored = await window.electron.store.get(STORAGE_KEY);
      if (stored && typeof stored === 'object') {
        const prefs = stored as Record<string, unknown>;
        const selectedModelId = isValidModelId(prefs.selectedModelId)
          ? prefs.selectedModelId
          : 'claude-haiku';
        set({
          selectedInstitution: (prefs.selectedInstitution as Institution) ?? null,
          selectedModelId,
          outputStyle: normalizeOutputStyle(prefs.outputStyle),
          autoExpandSources: (prefs.autoExpandSources as boolean) ?? false,
          showConfidenceScores: (prefs.showConfidenceScores as boolean) ?? true,
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch (error) {
      console.error('Failed to load preferences:', error);
      set({ isLoaded: true });
    }
  },

  setSelectedInstitution: (institution: Institution) => {
    set({ selectedInstitution: institution });
    savePreference('selectedInstitution', institution);
  },

  setSelectedModelId: (id: ModelId) => {
    set({ selectedModelId: id });
    savePreference('selectedModelId', id);
  },

  setOutputStyle: (style: OutputStyle) => {
    set({ outputStyle: style });
    savePreference('outputStyle', style);
  },

  setAutoExpandSources: (expand: boolean) => {
    set({ autoExpandSources: expand });
    savePreference('autoExpandSources', expand);
  },

  setShowConfidenceScores: (show: boolean) => {
    set({ showConfidenceScores: show });
    savePreference('showConfidenceScores', show);
  },
}));

// Helper to save individual preference
async function savePreference(key: string, value: unknown) {
  try {
    const stored = await window.electron.store.get(STORAGE_KEY);
    const current = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
    await window.electron.store.set(STORAGE_KEY, { ...current, [key]: value });
  } catch (error) {
    console.error('Failed to save preference:', error);
  }
}
