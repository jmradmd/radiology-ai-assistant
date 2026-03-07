import { create } from 'zustand';
import type { ModelId } from '../lib/constants';

interface VerbatimSource {
  title: string;
  content: string;
  category: string;
  institution?: string;
  similarity: number;
  url: string | null;
}

interface EmergencyAssessment {
  isEmergency: boolean;
  severity: 'routine' | 'urgent' | 'emergency';
  triggers: string[];
  escalators: string[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  verbatimSources?: VerbatimSource[];
  confidence?: number;
  emergencyAssessment?: EmergencyAssessment;
  timestamp: Date;
  isError?: boolean;
}

type Institution = 'INSTITUTION_A' | 'INSTITUTION_B' | 'SHARED' | null;

interface ChatState {
  messages: Message[];
  conversationId: string | null;
  isLoading: boolean;
  activeEmergency: EmergencyAssessment | null;
  selectedInstitution: Institution;
  selectedModelId: ModelId;

  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setLoading: (loading: boolean) => void;
  setConversationId: (id: string | null) => void;
  setActiveEmergency: (emergency: EmergencyAssessment | null) => void;
  setSelectedInstitution: (institution: Institution) => void;
  setSelectedModelId: (modelId: ModelId) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  conversationId: null,
  isLoading: false,
  activeEmergency: null,
  selectedInstitution: null,
  selectedModelId: 'claude-haiku',

  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setMessages: (messages) => set({ messages }),
  setLoading: (isLoading) => set({ isLoading }),
  setConversationId: (conversationId) => set({ conversationId }),
  setActiveEmergency: (activeEmergency) => set({ activeEmergency }),
  setSelectedInstitution: (selectedInstitution) => set({ selectedInstitution }),
  setSelectedModelId: (selectedModelId) => set({ selectedModelId }),
  clearChat: () => set({ messages: [], conversationId: null, isLoading: false, activeEmergency: null }),
}));
