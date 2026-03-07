import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_MODEL_ID, type Institution } from "@rad-assist/shared";

export type OutputStyle = "concise" | "detailed" | "auto";
export type Department = 
  | "ABDOMINAL"
  | "NEURO"
  | "MSK"
  | "CHEST"
  | "IR"
  | "PEDS"
  | "BREAST"
  | "NUCLEAR"
  | "CARDIAC"
  | "EMERGENCY"
  | "GENERAL";

// Model IDs match LLM_MODELS in @rad-assist/shared
export type ModelId =
  | "claude-opus"
  | "claude-sonnet"
  | "claude-haiku"
  | "gpt-5.2"
  | "minimax-m2.5"
  | "gemini-3.0"
  | "deepseek-r1"
  | "kimi-k2.5"
  | "local";

const VALID_MODEL_IDS: ReadonlySet<ModelId> = new Set([
  "claude-opus",
  "claude-sonnet",
  "claude-haiku",
  "gpt-5.2",
  "minimax-m2.5",
  "gemini-3.0",
  "deepseek-r1",
  "kimi-k2.5",
  "local",
]);

function isValidModelId(value: unknown): value is ModelId {
  return typeof value === "string" && VALID_MODEL_IDS.has(value as ModelId);
}

// Re-export types for convenience
export type { Institution };

interface UserPreferences {
  // Display preferences
  outputStyle: OutputStyle;
  showConfidenceScores: boolean;
  autoExpandSources: boolean;
  
  // Department/specialty
  department: Department | null;
  
  // LLM Model selection
  selectedModelId: ModelId;
  
  // Institution filter for RAG search
  selectedInstitution: Institution | null;
  
  // Theme is handled separately by the theme toggle

  // Memory behavior
  crossChatMemoryEnabled: boolean;
}

interface PreferencesState extends UserPreferences {
  setOutputStyle: (style: OutputStyle) => void;
  setShowConfidenceScores: (show: boolean) => void;
  setAutoExpandSources: (expand: boolean) => void;
  setDepartment: (dept: Department | null) => void;
  setSelectedModelId: (modelId: ModelId) => void;
  setSelectedInstitution: (institution: Institution | null) => void;
  setCrossChatMemoryEnabled: (enabled: boolean) => void;
  resetPreferences: () => void;
}

const defaultPreferences: UserPreferences = {
  outputStyle: "auto",
  showConfidenceScores: true,
  autoExpandSources: false,
  department: null,
  selectedModelId: DEFAULT_MODEL_ID as ModelId,  // Mirrors shared default model
  selectedInstitution: null,  // All sites by default
  crossChatMemoryEnabled: true,
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      ...defaultPreferences,
      setOutputStyle: (style) => set({ outputStyle: style }),
      setShowConfidenceScores: (show) => set({ showConfidenceScores: show }),
      setAutoExpandSources: (expand) => set({ autoExpandSources: expand }),
      setDepartment: (dept) => set({ department: dept }),
      setSelectedModelId: (modelId) => set({ selectedModelId: modelId }),
      setSelectedInstitution: (institution) => set({ selectedInstitution: institution }),
      setCrossChatMemoryEnabled: (enabled) => set({ crossChatMemoryEnabled: enabled }),
      resetPreferences: () => set(defaultPreferences),
    }),
    {
      name: "rad-assist-preferences",
      storage: createJSONStorage(() => localStorage),
      // Merge with defaults to handle migration
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<Omit<UserPreferences, "outputStyle">> & {
          outputStyle?: OutputStyle | "explanatory";
          selectedModelId?: string;
        };
        
        // Migrate "explanatory" to "auto" (v2 change)
        let outputStyle = persisted?.outputStyle;
        if (outputStyle === "explanatory") {
          outputStyle = "auto";
        }
        
        const selectedModelId = isValidModelId(persisted?.selectedModelId)
          ? persisted.selectedModelId
          : (DEFAULT_MODEL_ID as ModelId);

        return {
          ...currentState,
          ...persisted,
          // Ensure valid outputStyle (migrate explanatory -> auto)
          outputStyle: (outputStyle as OutputStyle) || currentState.outputStyle,
          // Ensure selectedModelId always maps to a current supported model
          selectedModelId,
          crossChatMemoryEnabled: persisted?.crossChatMemoryEnabled ?? currentState.crossChatMemoryEnabled,
        };
      },
    }
  )
);
