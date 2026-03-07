export const APP_BASE_URL = import.meta.env.VITE_APP_BASE_URL || 'http://localhost:3000';
export const API_URL = `${APP_BASE_URL}/api/trpc`;

export const AVAILABLE_MODELS = [
  {
    id: 'claude-opus',
    name: 'Claude Opus 4.6',
    description: 'Highest-stakes, multi-step clinical reasoning and synthesis.',
  },
  {
    id: 'claude-sonnet',
    name: 'Claude Sonnet 4.6',
    description: 'Default for daily protocol Q&A with balanced quality and speed.',
  },
  {
    id: 'claude-haiku',
    name: 'Claude Haiku 4.5',
    description: 'Low-latency routing, quick checks, and concise operations support.',
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    description: 'Coding-heavy and tool-using workflows needing structured output.',
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax-M2.5',
    description: 'Cost-efficient long-context sessions and high-throughput usage.',
  },
  {
    id: 'gemini-3.0',
    name: 'Gemini 3.0',
    description: 'Fast interactive turns with multimodal-friendly reasoning.',
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    description: 'Stepwise protocol reasoning for complex clinical edge cases.',
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    description: 'Rapid synthesis across very long policy context windows.',
  },
] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id'];

export const INSTITUTIONS = [
  { id: null, name: 'All Sources', shortName: 'All' },
  { id: 'INSTITUTION_A', name: 'Primary Hospital', shortName: 'HOSP_A' },
  { id: 'INSTITUTION_B', name: 'Department', shortName: 'DEPT' },
] as const;

export type InstitutionId = (typeof INSTITUTIONS)[number]['id'];

export const OUTPUT_STYLES = [
  { id: 'auto', name: 'Auto', description: 'Adapts to query' },
  { id: 'concise', name: 'Concise', description: 'Brief answers' },
  { id: 'detailed', name: 'Detailed', description: 'Comprehensive' },
] as const;

export type OutputStyle = (typeof OUTPUT_STYLES)[number]['id'];

export const EXAMPLE_QUERIES = [
  'What is the contrast reaction protocol?',
  'MRI safety screening for pacemaker',
  'eGFR threshold for IV contrast',
  'Premedication protocol for allergies',
];

export const CATEGORY_CHIPS = [
  { id: 'contrast', label: 'Contrast', category: 'CONTRAST' },
  { id: 'mri-safety', label: 'MRI Safety', category: 'MRI_SAFETY' },
  { id: 'ct-protocol', label: 'CT Protocol', category: 'CT_PROTOCOL' },
  { id: 'renal', label: 'Renal/eGFR', category: 'RENAL' },
  { id: 'peds', label: 'Pediatric', category: 'PEDIATRIC' },
  { id: 'safety', label: 'General Safety', category: 'SAFETY' },
] as const;
