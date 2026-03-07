import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, createTrpcClient } from './lib/trpc';
import { useAuthStore } from './stores/auth';
import { useChatStore, type Message } from './stores/chat';
import { usePreferencesStore } from './stores/preferences';
import { LoginPrompt } from './components/LoginPrompt';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { EmergencyBanner } from './components/EmergencyBanner';
import { generateId, cn } from './lib/utils';
import { APP_BASE_URL } from './lib/constants';
import { RotateCcw, SlidersHorizontal, Building2, Cpu, ChevronDown, ArrowRight, LogOut } from 'lucide-react';
import { AppLogo } from './components/AppLogo';
import { LoadingIndicator } from './components/LoadingIndicator';

// Valid model IDs matching the API schema
type ModelId =
  | 'claude-opus'
  | 'claude-sonnet'
  | 'claude-haiku'
  | 'gpt-5.2'
  | 'minimax-m2.5'
  | 'gemini-3.0'
  | 'deepseek-r1'
  | 'kimi-k2.5';

const MODELS: { id: ModelId; name: string }[] = [
  { id: 'claude-opus', name: 'Claude Opus 4.6' },
  { id: 'claude-sonnet', name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku', name: 'Claude Haiku 4.5' },
  { id: 'gpt-5.2', name: 'GPT-5.2' },
  { id: 'minimax-m2.5', name: 'MiniMax-M2.5' },
  { id: 'gemini-3.0', name: 'Gemini 3.0' },
  { id: 'deepseek-r1', name: 'DeepSeek R1' },
  { id: 'kimi-k2.5', name: 'Kimi K2.5' },
];

const INSTITUTIONS = [
  { id: null, name: 'All Sources', shortName: 'All' },
  { id: 'INSTITUTION_A', name: 'Primary Hospital', shortName: 'HOSP_A' },
  { id: 'INSTITUTION_B', name: 'Department', shortName: 'DEPT' },
];

const EXAMPLES = [
  'What is the contrast reaction protocol?',
  'MRI safety screening for pacemaker',
  'eGFR threshold for IV contrast',
  'Premedication protocol for allergies',
];

function ChatApp() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showInstitutionMenu, setShowInstitutionMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const {
    messages, conversationId, isLoading, activeEmergency,
    selectedInstitution, selectedModelId,
    addMessage, setMessages, setLoading, setConversationId, setActiveEmergency,
    setSelectedInstitution, setSelectedModelId, clearChat
  } = useChatStore();
  const { outputStyle, loadPreferences } = usePreferencesStore();

  const { logout, getToken } = useAuthStore();

  const ragChat = trpc.rag.chat.useMutation();
  const requestSequenceRef = useRef(0);
  const activeRequestIdRef = useRef<number | null>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 50);
  };

  useEffect(() => { scrollToBottom(); }, [messages.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.electron.hideWindow();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const runChatQuery = useCallback((query: string, options?: { conversationIdOverride?: string | null }) => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    activeRequestIdRef.current = requestId;
    setLoading(true);

    const effectiveConversationId =
      options?.conversationIdOverride !== undefined
        ? options.conversationIdOverride
        : conversationId;

    ragChat.mutate(
      {
        query,
        conversationId: effectiveConversationId ?? undefined,
        institution: selectedInstitution ?? undefined,
        modelId: selectedModelId as ModelId,
        outputStyle,
      },
      {
        onSuccess: (data) => {
          if (activeRequestIdRef.current !== requestId) return;

          const msg: Message = {
            id: generateId(),
            role: 'assistant',
            content: data.summary || data.answer,
            verbatimSources: data.verbatimSources,
            confidence: data.confidence,
            emergencyAssessment: data.emergencyAssessment,
            timestamp: new Date(),
          };
          addMessage(msg);
          setConversationId(data.conversationId);
          setLoading(false);

          if (data.emergencyAssessment?.isEmergency || data.emergencyAssessment?.severity === 'urgent') {
            setActiveEmergency(data.emergencyAssessment);
          } else {
            setActiveEmergency(null);
          }
          scrollToBottom();
        },
        onError: (error) => {
          if (activeRequestIdRef.current !== requestId) return;
          setLoading(false);

          if (error.data?.code === 'UNAUTHORIZED') {
            logout();
            return;
          }
          addMessage({
            id: generateId(),
            role: 'assistant',
            content: `Error: ${error.message}`,
            timestamp: new Date(),
            isError: true,
          });
        },
      }
    );
  }, [
    addMessage,
    conversationId,
    logout,
    outputStyle,
    ragChat,
    selectedInstitution,
    selectedModelId,
    setActiveEmergency,
    setConversationId,
    setLoading,
  ]);

  const handleSend = (query: string) => {
    if (!query.trim() || isLoading) return;
    addMessage({ id: generateId(), role: 'user', content: query.trim(), timestamp: new Date() });
    scrollToBottom();
    runChatQuery(query.trim());
  };

  const handleRetryTurn = useCallback((assistantMessageId: string) => {
    if (isLoading) return;
    const assistantIndex = messages.findIndex((m) => m.id === assistantMessageId);
    if (assistantIndex === -1 || messages[assistantIndex]?.role !== 'assistant') return;

    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex]?.role !== 'user') userIndex -= 1;
    if (userIndex < 0) return;

    const userPrompt = messages[userIndex]?.content?.trim();
    if (!userPrompt) return;

    setMessages(messages.slice(0, assistantIndex));
    setConversationId(null);
    setActiveEmergency(null);
    runChatQuery(userPrompt, { conversationIdOverride: null });
  }, [isLoading, messages, runChatQuery, setMessages, setConversationId, setActiveEmergency]);

  const handleEditTurn = useCallback((userMessageId: string, editedContent: string) => {
    const normalized = editedContent.trim();
    if (!normalized) return;

    const userIndex = messages.findIndex((m) => m.id === userMessageId);
    if (userIndex === -1 || messages[userIndex]?.role !== 'user') return;

    const updated = messages.slice(0, userIndex + 1);
    updated[userIndex] = {
      ...updated[userIndex],
      content: normalized,
      timestamp: new Date(),
    };

    setMessages(updated);
    setConversationId(null);
    setActiveEmergency(null);
    runChatQuery(normalized, { conversationIdOverride: null });
  }, [messages, runChatQuery, setMessages, setConversationId, setActiveEmergency]);

  const handleNewChat = () => {
    clearChat();
    setActiveEmergency(null);
    setTimeout(() => document.getElementById('chat-input')?.focus(), 50);
  };

  const currentModel = MODELS.find(m => m.id === selectedModelId) || MODELS[0];
  const currentInstitution = INSTITUTIONS.find(i => i.id === selectedInstitution) || INSTITUTIONS[0];

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Title bar */}
      <div 
        className="h-10 flex items-center justify-between px-3 border-b border-gray-200 bg-gray-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <AppLogo size={24} variant="teal" />
          <span className="font-semibold text-gray-800">Radiology AI Assistant</span>
        </div>
        <button 
          onClick={() => window.electron.hideWindow()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          ×
        </button>
      </div>

      {/* Emergency banner */}
      {activeEmergency && (
        <EmergencyBanner assessment={activeEmergency} onDismiss={() => setActiveEmergency(null)} />
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center mb-4 shadow-lg">
              <AppLogo size={40} variant="white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Protocol Assistant</h2>
            <p className="text-sm text-gray-500 text-center mb-6">Ask about radiology protocols and guidelines.</p>
            <div className="w-full max-w-sm space-y-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Try asking</p>
              {EXAMPLES.map((example, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(example)}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 text-left"
                >
                  <span className="text-sm text-gray-700">{example}</span>
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, index) => {
              const relatedPromptContent =
                msg.role === 'assistant'
                  ? [...messages.slice(0, index)].reverse().find((candidate) => candidate.role === 'user')?.content
                  : undefined;

              return (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  disableActions={isLoading}
                  onRetryTurn={handleRetryTurn}
                  onEditTurn={handleEditTurn}
                  relatedPromptContent={relatedPromptContent}
                />
              );
            })}
            {isLoading && (
              <div className="py-2">
                <LoadingIndicator />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput onSubmit={handleSend} isLoading={isLoading} />

      {/* Status bar */}
      <div className="h-11 px-3 flex items-center justify-between border-t border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          {/* Institution selector */}
          <div className="relative">
            <button
              onClick={() => { setShowInstitutionMenu(!showInstitutionMenu); setShowModelMenu(false); }}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-200"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{currentInstitution.shortName}</span>
              <ChevronDown className={cn('w-3 h-3 transition-transform', showInstitutionMenu && 'rotate-180')} />
            </button>
            {showInstitutionMenu && (
              <div className="absolute bottom-full left-0 mb-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50">
                {INSTITUTIONS.map((inst) => (
                  <button
                    key={inst.id ?? 'all'}
                    onClick={() => { setSelectedInstitution(inst.id as any); setShowInstitutionMenu(false); }}
                    className={cn('w-full px-3 py-2 text-sm text-left hover:bg-gray-50', selectedInstitution === inst.id && 'bg-gray-50')}
                  >
                    <p className="font-medium">{inst.shortName}</p>
                    <p className="text-xs text-gray-500">{inst.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-gray-200" />

          {/* Model selector */}
          <div className="relative">
            <button
              onClick={() => { setShowModelMenu(!showModelMenu); setShowInstitutionMenu(false); }}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-200"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span className="max-w-[80px] truncate">{currentModel.name}</span>
              <ChevronDown className={cn('w-3 h-3 transition-transform', showModelMenu && 'rotate-180')} />
            </button>
            {showModelMenu && (
              <div className="absolute bottom-full left-0 mb-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50">
                {MODELS.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => { setSelectedModelId(model.id); setShowModelMenu(false); }}
                    className={cn('w-full px-3 py-2 text-sm text-left hover:bg-gray-50', selectedModelId === model.id && 'bg-gray-50')}
                  >
                    {model.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={handleNewChat} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200" title="New chat">
            <RotateCcw className="w-4 h-4 text-gray-500" />
          </button>
          <div className="relative">
            <button onClick={() => setShowSettings(!showSettings)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200" title="Settings">
              <SlidersHorizontal className="w-4 h-4 text-gray-500" />
            </button>
            {showSettings && (
              <div className="absolute bottom-full right-0 mb-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50">
                <button
                  onClick={() => { window.electron.openExternal(APP_BASE_URL); setShowSettings(false); }}
                  className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 text-gray-700"
                >
                  Open in Browser
                </button>
                <button
                  onClick={() => { logout(); setShowSettings(false); }}
                  className="w-full px-3 py-2 text-sm text-left hover:bg-red-50 text-red-600 flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, isLoading, checkAuth, getToken } = useAuthStore();
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 5000, refetchOnWindowFocus: false } },
  }));
  const [trpcClient] = useState(() => createTrpcClient(getToken));

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPrompt />;
  }

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ChatApp />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
