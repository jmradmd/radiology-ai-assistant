/**
 * RAG Configuration for Radiology Protocol Assistant
 *
 * Model selection is now user-configurable via LLM_MODELS in @rad-assist/shared.
 * Default model: Claude Haiku 4.5 (`claude-haiku`).
 * Provider fallback order is defined in `llm-client.ts`.
 *
 * Embeddings always use OpenAI (for vector compatibility).
 */

export const RAG_CONFIG = {
  // ════════════════════════════════════════════════════════════════════════════
  // NOTE: LLM model selection moved to @rad-assist/shared (LLM_MODELS, DEFAULT_MODEL_ID)
  // The llm-client.ts now handles provider selection based on user preference.
  // ════════════════════════════════════════════════════════════════════════════
  
  // Embeddings - Always OpenAI (compatible with existing vectors in pgvector)
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMENSIONS: 1536,
  
  // Retrieval Settings
  MIN_CONFIDENCE_THRESHOLD: 0.50,  // Lower threshold to catch more relevant content
  HIGH_CONFIDENCE_THRESHOLD: 0.70, // Above this, we're confident in the answer
  MAX_SEARCH_RESULTS: 8,          // Fetch more candidates for filtering (was 5)
  MAX_VERBATIM_SOURCES: 3,

  // Minimum cosine similarity to DISPLAY a source to the user
  // Below this threshold, sources are too noisy to show
  MIN_DISPLAY_SIMILARITY: 0.52,    // Protocol mode (category boost can inflate scores)
  MIN_DISPLAY_SIMILARITY_KNOWLEDGE: 0.55, // Knowledge mode (stricter — no category boost available for most docs)
  
  // Token limits
  MAX_CONTEXT_TOKENS: 8000,
  
  // Emergency Detection Keywords
  EMERGENCY_KEYWORDS: [
    // Respiratory
    'desaturation', 'desaturating', 'o2 sat', 'spo2', 'oxygen dropping',
    'can\'t breathe', 'difficulty breathing', 'respiratory distress',
    'stridor', 'wheezing', 'airway', 'throat closing', 'throat tightness',
    'shortness of breath', 'dyspnea', 'tachypnea',
    'apnea', 'not breathing', 'respiratory arrest', 'laryngospasm', 'aspiration',

    // Cardiovascular
    'hypotension', 'blood pressure dropping', 'bp dropping', 'shock',
    'unresponsive', 'unconscious', 'syncope', 'cardiac arrest',
    'bradycardia', 'tachycardia', 'arrhythmia', 'chest pain',
    'pulseless', 'no pulse', 'hemorrhage', 'active bleeding', 'exsanguinating',

    // Neurological
    'seizure', 'seizing', 'convulsion', 'convulsing', 'status epilepticus',
    'postictal', 'stroke', 'code stroke', 'hemiparesis', 'aphasia', 'facial droop',

    // Thoracic
    'pneumothorax', 'tension pneumothorax',

    // Anaphylaxis / Other
    'anaphylaxis', 'anaphylactic', 'severe reaction', 'code',
    'widespread hives', 'diffuse hives', 'angioedema', 'facial swelling',
    'tongue swelling', 'lip swelling',
    'malignant hyperthermia', 'compartment syndrome',

    // General urgency
    'emergency', 'stat', 'critical', 'crashing', 'deteriorating',
  ],
  
  // Severity indicators that upgrade urgency
  SEVERITY_ESCALATORS: [
    'not responding to', 'despite', 'still', 'worsening', 'progressing',
    'given benadryl', 'already gave', 'already administered',
    'failed', 'refractory', 'persistent', 'increasing',
  ],
  
  // Numeric patterns that indicate emergencies
  CRITICAL_THRESHOLDS: {
    O2_SAT_LOW: 92,    // Below this is concerning
    BP_SYSTOLIC_LOW: 90, // Below this is hypotension
    HR_HIGH: 150,       // Above this is critical tachycardia
    HR_LOW: 40,         // Below this is critical bradycardia
  },

  TEAMS_TIER_CONFIG: {
    SOURCE_COLLECTION: "teams_abdominal",
    ABDOMINAL_TRIGGER_KEYWORDS: [
      "abdominal",
      "abdomen",
      "gastro",
      "gastrointestinal",
      "gi",
      "bowel",
      "colitis",
      "pancreas",
      "liver",
      "spleen",
      "renal",
      "ivc",
      "mesent",
      "upper gi",
      "lower gi",
    ],
    DEPARTMENT: "ABDOMINAL",
    REFERENCE_BONUS: 0.05,
    CLINICAL_ADJUSTMENT: 0,
    EDUCATIONAL_PENALTY: -0.03,
    T1_BONUS_BLOCKED_CATEGORIES: [
      "MRI_SAFETY",
    ],
    SOURCE_COLLECTION_T1_CONDITION: "routine",
  } as const,
} as const;

export type RagConfig = typeof RAG_CONFIG;
