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

// Model IDs cover both the static LLM_MODELS entries in @rad-assist/shared
// and dynamically-discovered local model names (e.g., the values reported by
// a local server's /v1/models endpoint). Validation is purely shape-based;
// authoritative resolution happens server-side via resolveModelConfig.
export type ModelId = string;

function isValidModelId(value: unknown): value is ModelId {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 100
  );
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
