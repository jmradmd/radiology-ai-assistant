"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  User,
  ChevronDown,
  ChevronUp,
  FileText,
  AlertTriangle,
  Phone,
  ExternalLink,
  HelpCircle,
  Search,
  Copy,
  Check,
  RotateCcw,
  Pencil,
} from "lucide-react";
import { AppLogo } from "@/components/ui/app-logo";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import { SidebarNav } from "@/components/chat/sidebar-nav";
import { SearchModal } from "@/components/chat/search-modal";
import { EmptyState } from "@/components/chat/empty-state";
import { ChatInput, type ChatInputHandle } from "@/components/chat/chat-input";
import { LoadingIndicator } from "@/components/chat/loading-indicator";
import { ConfigBanner } from "@/components/chat/config-banner";
import { INSTITUTION_CONFIG, type Institution, type PHIOverrideSelection, type VerbatimSource } from "@rad-assist/shared";
import { trpc } from "@/lib/trpc/client";
import { usePreferencesStore } from "@/stores/preferences";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/components/ui/use-toast";

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

interface EmergencyAssessment {
  isEmergency: boolean;
  severity: "routine" | "urgent" | "emergency";
  triggers: string[];
  escalators: string[];
  numericAlerts?: string[];
}

interface Citation {
  documentTitle: string;
  source?: string;
  category?: string;
  section?: string;
  page?: number;
  relevantText: string;
  similarity?: number;
  filename?: string;
}

interface ModelInfo {
  requested: string;
  actual: string;
  provider: string;
  fallbackUsed: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  verbatimSources?: VerbatimSource[];
  confidence?: number;
  emergencyAssessment?: EmergencyAssessment;
  modelInfo?: ModelInfo;
  timestamp: Date;
  isError?: boolean;
  needsAbbreviationClarification?: boolean;
  abbreviationOptions?: string[];
  abbreviation?: string;
}

// Note: Category chips removed in favor of reactive topic detection
// Topics are now detected server-side and suggested contextually

// ════════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Emergency Side Panel - Floating overlay on the right side of the chat
 * Doesn't affect main content layout - overlays on top
 */
function EmergencySidePanel({ 
  assessment, 
  onDismiss 
}: { 
  assessment: EmergencyAssessment;
  onDismiss: () => void;
}) {
  if (assessment.severity === "routine") return null;

  const isEmergency = assessment.severity === "emergency";

  return (
    <div role="alert" aria-live="assertive" className="fixed top-16 right-4 w-72 max-h-[calc(100vh-8rem)] rounded-xl shadow-2xl border border-amber-300/50 dark:border-amber-600/50 bg-amber-50 dark:bg-slate-800/95 backdrop-blur-sm overflow-y-auto z-40 animate-slide-in-right">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
              isEmergency 
                ? "bg-amber-500 text-white" 
                : "bg-amber-400 text-white"
            )}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-amber-700 dark:text-amber-300 text-base">
                {isEmergency ? "EMERGENCY" : "URGENT"}
              </div>
              <div className="text-xs text-amber-600 dark:text-amber-400">
                Clinical alert active
              </div>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-lg hover:bg-amber-200/50 dark:hover:bg-slate-700 text-amber-600 dark:text-slate-400"
            aria-label="Dismiss alert"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Triggers */}
        {assessment.triggers.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Detected Concerns
            </div>
            <div className="flex flex-wrap gap-1.5">
              {assessment.triggers.map((trigger, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 text-xs rounded-full bg-amber-200 dark:bg-amber-600/30 text-amber-800 dark:text-amber-200 font-medium"
                >
                  {trigger}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Escalators */}
        {assessment.escalators && assessment.escalators.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Severity Indicators
            </div>
            <div className="flex flex-wrap gap-1.5">
              {assessment.escalators.map((esc, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 text-xs rounded-full bg-amber-300 dark:bg-amber-500/30 text-amber-900 dark:text-amber-100 font-medium"
                >
                  {esc}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Numeric Alerts */}
        {assessment.numericAlerts && assessment.numericAlerts.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Critical Values
            </div>
            <div className="space-y-1">
              {assessment.numericAlerts.map((alert, i) => (
                <div
                  key={i}
                  className="px-3 py-2 text-sm rounded-xl bg-amber-300/50 dark:bg-amber-600/20 text-amber-900 dark:text-amber-100 font-mono border border-amber-300 dark:border-amber-600/30"
                >
                  {alert}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="pt-2 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Quick Actions
          </div>
          <a
            href="tel:911"
            className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors shadow-md"
          >
            <Phone className="w-4 h-4" />
            Call Emergency Response (911)
          </a>
        </div>

        {/* Disclaimer */}
        <p className="text-[10px] text-amber-700 dark:text-slate-400 leading-relaxed">
          This assessment is based on keywords detected in your query. Always use clinical judgment and follow institutional protocols.
        </p>
      </div>
    </div>
  );
}

function VerbatimSourcesPanel({
  sources,
  isExpanded,
  onToggle,
  onPdfClick,
}: {
  sources: VerbatimSource[];
  isExpanded: boolean;
  onToggle: () => void;
  onPdfClick?: (url: string, title: string) => void;
}) {
  // Track which sources have expanded text
  const [expandedText, setExpandedText] = useState<Record<number, boolean>>({});
  
  const EXCERPT_LENGTH = 180; // ~2 lines of text

  const getExcerpt = (content: string) => {
    if (content.length <= EXCERPT_LENGTH) return { excerpt: content, hasMore: false };
    // Find a good break point (end of sentence or word)
    let breakPoint = content.lastIndexOf('. ', EXCERPT_LENGTH);
    if (breakPoint === -1 || breakPoint < 100) {
      breakPoint = content.lastIndexOf(' ', EXCERPT_LENGTH);
    }
    if (breakPoint === -1) breakPoint = EXCERPT_LENGTH;
    return { excerpt: content.slice(0, breakPoint + 1).trim(), hasMore: true };
  };

  return (
    <div className="mt-3">
      {/* Collapsed header bar */}
      <button
        onClick={onToggle}
        className={cn(
          "w-full px-4 py-2.5 flex items-center justify-between rounded-2xl transition-colors",
          "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700",
          "border border-slate-200 dark:border-slate-700",
          isExpanded && "rounded-b-none border-b-0"
        )}
      >
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-2">
          <FileText className="w-3.5 h-3.5" />
          {sources.length} source{sources.length !== 1 ? "s" : ""} cited
        </span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {/* Expanded: show all sources */}
      {isExpanded && (
        <div className="border border-t-0 border-slate-200 dark:border-slate-700 rounded-b-2xl bg-slate-50 dark:bg-slate-800/50 divide-y divide-slate-200 dark:divide-slate-700">
          {sources.map((source, i) => {
            const instConfig =
              source.institution && source.institution in INSTITUTION_CONFIG
                ? INSTITUTION_CONFIG[source.institution as Institution]
                : null;
            const { excerpt, hasMore } = getExcerpt(source.content);
            const isTextExpanded = expandedText[i] ?? false;

            return (
              <div key={i} className="p-3">
                {/* Source header: badge + title + PDF link (inline) */}
                <div className="flex items-start gap-2 mb-1.5">
                  {/* Institution badge */}
                  {instConfig && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex-shrink-0 mt-0.5"
                      style={{
                        backgroundColor: instConfig.colors.background,
                        color: instConfig.colors.text,
                      }}
                    >
                      {instConfig.shortName}
                    </span>
                  )}
                  <div className="min-w-0">
                    {/* Title with PDF link inline */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 leading-tight">
                        {source.title}
                      </span>
                      {source.url && (
                        <button
                          onClick={() => onPdfClick ? onPdfClick(source.url!, source.title) : window.open(source.url!, '_blank')}
                          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:underline cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {source.pageStart ? `p.${source.pageStart}${source.pageEnd && source.pageEnd !== source.pageStart ? `-${source.pageEnd}` : ""}` : "PDF"}
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {source.category} • {source.similarity}% match
                    </div>
                  </div>
                </div>

                {/* Short excerpt with expand option */}
                <div className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  <span className="italic">
                    &quot;{isTextExpanded ? source.content : excerpt}
                    {!isTextExpanded && hasMore && "..."}
                    &quot;
                  </span>
                  {hasMore && (
                    <button
                      onClick={() => setExpandedText(prev => ({ ...prev, [i]: !prev[i] }))}
                      className="ml-1 text-brand-600 dark:text-brand-400 hover:underline font-medium"
                    >
                      {isTextExpanded ? "less" : "more"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percentage = Math.min(100, Math.round(confidence * 100));
  
  // Confidence thresholds: ≥70% green, ≥50% amber, <50% gray
  const getConfidenceStyles = () => {
    if (percentage >= 70) {
      return "bg-success-100 dark:bg-success-700/30 text-success-700 dark:text-success-400";
    } else if (percentage >= 50) {
      return "bg-emergency-100 dark:bg-emergency-700/30 text-emergency-700 dark:text-emergency-400";
    } else {
      return "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400";
    }
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full",
        getConfidenceStyles()
      )}
    >
      {percentage}% confidence
    </span>
  );
}

interface AbbreviationClarificationProps {
  abbreviation: string;
  options: string[];
  onSelect: (meaning: string) => void;
}

function AbbreviationClarification({
  abbreviation,
  options,
  onSelect,
}: AbbreviationClarificationProps) {
  return (
    <div className="bg-emergency-50 dark:bg-emergency-700/20 border border-emergency-300 dark:border-emergency-600 rounded-xl p-4 space-y-3 mt-3 shadow-emergency">
      <div className="flex items-center gap-2 text-emergency-700 dark:text-emergency-400">
        <HelpCircle className="w-5 h-5" />
        <span className="font-semibold text-[15px]">Clarification needed</span>
      </div>

      <p className="text-slate-700 dark:text-slate-300 text-sm">
        The abbreviation <strong className="text-slate-800 dark:text-slate-100">&quot;{abbreviation}&quot;</strong> can mean
        several things. Please select the intended meaning:
      </p>

      <div className="grid gap-2">
        {options.map((option, i) => (
          <button
            key={i}
            onClick={() => onSelect(option)}
            className="text-left px-4 py-2.5 rounded-xl border border-emergency-200 dark:border-emergency-600 bg-white dark:bg-slate-800 hover:bg-emergency-50 dark:hover:bg-emergency-700/30 hover:border-emergency-300 dark:hover:border-emergency-500 transition-all text-sm"
          >
            <span className="font-semibold text-emergency-700 dark:text-emergency-400">{i + 1}.</span>{" "}
            <span className="text-slate-700 dark:text-slate-300">{option}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Topic clarification UI removed - detection happens silently in backend for category boosting

// ════════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════════

export default function ChatPage() {
  const router = useRouter();
  const { logout, accessToken } = useAuthStore();
  const { toast } = useToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [activeEmergency, setActiveEmergency] = useState<EmergencyAssessment | null>(null);
  const [pdfViewer, setPdfViewer] = useState<{ url: string; title: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);

  const utils = trpc.useUtils();
  const { 
    autoExpandSources, 
    showConfidenceScores, 
    outputStyle, 
    department, 
    selectedModelId,
    selectedInstitution,
    setSelectedInstitution,
  } = usePreferencesStore();
  
  // Handle auth errors by redirecting to login
  const handleAuthError = useCallback(() => {
    logout();
    router.replace("/login");
  }, [logout, router]);

  // Fetch conversation when conversationId changes
  useEffect(() => {
    if (conversationId) {
      utils.conversation.getRagChatMessages
        .fetch({ id: conversationId })
        .then((data) => {
          if (data?.messages) {
            setMessages(
              data.messages.map((m) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                citations: m.citations as Citation[] | undefined,
                verbatimSources: m.verbatimSources as VerbatimSource[] | undefined,
                emergencyAssessment: m.emergencyAssessment as EmergencyAssessment | undefined,
                confidence: m.confidence as number | undefined,
                timestamp: new Date(m.timestamp),
              }))
            );
          }
        })
        .catch((err) => {
          console.error("Failed to load conversation:", err);
          toast({
            variant: "destructive",
            title: "Failed to load conversation",
            description: "Please try again or start a new chat.",
          });
        });
    }
  }, [conversationId, utils.conversation.getRagChatMessages]);

  // Handle new chat
  const handleNewChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setSelectedInstitution(null);
    setInput("");
    setExpandedSources({});
    setPdfViewer(null);
    setActiveEmergency(null);
    inputRef.current?.focus();
  }, []);

  // Keyboard shortcuts (must be after handleNewChat is defined)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K = Search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
      // Cmd/Ctrl + N = New Chat
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        handleNewChat();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleNewChat]);

  // Handle selecting a conversation from history
  const handleSelectConversation = useCallback((id: string) => {
    setConversationId(id);
    setExpandedSources({});
    setPdfViewer(null);
    setActiveEmergency(null);
    setInput("");
  }, []);

  // On-call providers state
  const [onCallProviders, setOnCallProviders] = useState<any>(null);

  useEffect(() => {
    utils.schedule.getCurrentOnCall
      .fetch(undefined)
      .then(setOnCallProviders)
      .catch(console.error);

    const interval = setInterval(() => {
      utils.schedule.getCurrentOnCall
        .fetch(undefined)
        .then(setOnCallProviders)
        .catch(console.error);
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [utils.schedule.getCurrentOnCall]);

  // Real tRPC mutation for RAG chat
  const ragChat = trpc.rag.chat.useMutation({
    onSuccess: (data) => {
      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId);
      }

      const messageId = crypto.randomUUID();
      const assistantMessage: Message = {
        id: messageId,
        role: "assistant",
        content: data.summary || data.answer,
        citations: data.citations,
        verbatimSources: data.verbatimSources,
        confidence: data.confidence,
        emergencyAssessment: data.emergencyAssessment,
        modelInfo: data.modelInfo,
        timestamp: new Date(),
        needsAbbreviationClarification: data.needsAbbreviationClarification,
        abbreviationOptions: data.abbreviationOptions,
        abbreviation: data.abbreviation,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      
      // Log fallback warning to console for debugging
      if (data.modelInfo?.fallbackUsed) {
        console.warn(`[Chat] Model fallback: Requested ${data.modelInfo.requested} but got ${data.modelInfo.actual} (${data.modelInfo.provider})`);
      }

      // Show emergency side panel for emergency/urgent scenarios
      if (
        data.emergencyAssessment?.isEmergency ||
        data.emergencyAssessment?.severity === "urgent"
      ) {
        setExpandedSources((prev) => ({ ...prev, [messageId]: true }));
        setActiveEmergency(data.emergencyAssessment);
      }
    },
    onError: (error) => {
      console.error("RAG chat error:", error);
      console.error("Error details:", {
        code: error.data?.code,
        message: error.message,
        hasToken: !!accessToken,
      });
      
      // Only redirect on explicit UNAUTHORIZED code - not string matching
      // This prevents false positives from other errors that might contain "logged in"
      if (error.data?.code === "UNAUTHORIZED") {
        console.error("[Chat] UNAUTHORIZED error - redirecting to login");
        handleAuthError();
        return;
      }
      
      // Show error message to user instead of redirecting
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          error.message ||
          "Sorry, I encountered an error processing your request. Please try again.",
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    },
  });

  const isLoading = ragChat.isPending;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (options?: { phiOverrides?: PHIOverrideSelection[] }) => {
    if (!input.trim() || isLoading) return;

    // Note: We don't pre-check accessToken here anymore.
    // The tRPC client will send whatever token is available (or none),
    // and we handle UNAUTHORIZED errors in onError instead.
    // This prevents false-positive redirects during hydration race conditions.

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const query = input.trim();
    setInput("");

    const phiOverride = options?.phiOverrides && options.phiOverrides.length > 0;
    ragChat.mutate({
      query,
      ...(selectedInstitution && { institution: selectedInstitution }),
      ...(conversationId && { conversationId }),
      outputStyle,
      ...(department && { userDepartment: department }),
      modelId: selectedModelId,
      ...(phiOverride && { phiOverride: true }),
    });
  };

  // Clear chat when institution changes (from settings panel)
  // Skip on initial mount/hydration by tracking if user has interacted
  const hasUserInteracted = useRef(false);
  const prevInstitutionRef = useRef(selectedInstitution);
  
  useEffect(() => {
    // Skip the first render and hydration - only react to user-initiated changes
    if (!hasUserInteracted.current) {
      prevInstitutionRef.current = selectedInstitution;
      return;
    }
    
    if (prevInstitutionRef.current !== selectedInstitution && messages.length > 0) {
      setMessages([]);
      setConversationId(null);
      setExpandedSources({});
      setPdfViewer(null);
      setActiveEmergency(null);
    }
    prevInstitutionRef.current = selectedInstitution;
  }, [selectedInstitution]);
  
  // Mark user as having interacted after first message
  useEffect(() => {
    if (messages.length > 0) {
      hasUserInteracted.current = true;
    }
  }, [messages.length]);

  const handleAbbreviationClarification = (
    meaning: string,
    abbreviation: string
  ) => {
    const clarificationMessage = `I meant ${abbreviation} = ${meaning}. Please continue with my original question.`;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: clarificationMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);

    ragChat.mutate({
      query: clarificationMessage,
      ...(selectedInstitution && { institution: selectedInstitution }),
      ...(conversationId && { conversationId }),
      outputStyle,
      ...(department && { userDepartment: department }),
      modelId: selectedModelId,
    });
  };

  const handleRetryTurn = useCallback(
    (assistantMessageId: string) => {
      if (isLoading) return;
      const assistantIndex = messages.findIndex((m) => m.id === assistantMessageId);
      if (assistantIndex === -1 || messages[assistantIndex]?.role !== "assistant") return;

      let userIndex = assistantIndex - 1;
      while (userIndex >= 0 && messages[userIndex]?.role !== "user") userIndex -= 1;
      if (userIndex < 0) return;

      const userPrompt = messages[userIndex]?.content?.trim();
      if (!userPrompt) return;

      setMessages(messages.slice(0, assistantIndex));
      setConversationId(null);
      setExpandedSources({});
      setActiveEmergency(null);

      ragChat.mutate({
        query: userPrompt,
        ...(selectedInstitution && { institution: selectedInstitution }),
        outputStyle,
        ...(department && { userDepartment: department }),
        modelId: selectedModelId,
      });
    },
    [isLoading, messages, selectedInstitution, outputStyle, department, selectedModelId, ragChat]
  );

  const handleEditTurn = useCallback(
    (userMessageId: string, editedContent: string) => {
      const normalized = editedContent.trim();
      if (!normalized) return;

      const userIndex = messages.findIndex((m) => m.id === userMessageId);
      if (userIndex === -1 || messages[userIndex]?.role !== "user") return;

      const updated = [...messages.slice(0, userIndex + 1)];
      updated[userIndex] = {
        ...updated[userIndex]!,
        content: normalized,
        timestamp: new Date(),
      };

      setMessages(updated);
      setConversationId(null);
      setExpandedSources({});
      setActiveEmergency(null);

      ragChat.mutate({
        query: normalized,
        ...(selectedInstitution && { institution: selectedInstitution }),
        outputStyle,
        ...(department && { userDepartment: department }),
        modelId: selectedModelId,
      });
    },
    [messages, selectedInstitution, outputStyle, department, selectedModelId, ragChat]
  );

  const handleExampleClick = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  const coverageText = onCallProviders?.length
    ? onCallProviders
        .filter((p: any) => p.isPrimary)
        .map((p: any) => `${p.name} (${p.subspecialty})`)
        .join(", ")
    : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem-env(safe-area-inset-bottom))] bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* Left Sidebar Navigation */}
      <SidebarNav
        onNewChat={handleNewChat}
        onOpenSearch={() => setShowSearch(true)}
        onSelectConversation={handleSelectConversation}
        currentConversationId={conversationId}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white dark:bg-slate-900">
        <ConfigBanner />
        {/* Messages Area */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {messages.length === 0 ? (
              /* Empty State - Centered vertically with offset for input area */
              <div className="flex-1 flex items-center justify-center overflow-hidden">
                <EmptyState onExampleClick={handleExampleClick} />
              </div>
            ) : (
              /* Messages - Scrollable */
              <ScrollArea ref={scrollRef} className="flex-1 p-4">
                <div className="space-y-4 max-w-3xl mx-auto pb-4">
                  {messages.map((message) => (
                    <ChatMessage
                      key={message.id}
                      message={message}
                      sourcesExpanded={expandedSources[message.id] ?? autoExpandSources}
                      onToggleSources={() =>
                        setExpandedSources((prev) => ({
                          ...prev,
                          [message.id]: !(prev[message.id] ?? autoExpandSources),
                        }))
                      }
                      onAbbreviationClarification={handleAbbreviationClarification}
                      showConfidence={showConfidenceScores}
                      onPdfClick={(url, title) => setPdfViewer({ url, title })}
                      onRetryTurn={handleRetryTurn}
                      onEditTurn={handleEditTurn}
                      disableActions={isLoading}
                    />
                  ))}
                    {isLoading && (
                    <div className="flex gap-3">
                      <LoadingIndicator />
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
        </div>

        {/* Input Area - Fixed at bottom */}
        <footer className="flex-shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-3 px-4">
          <ChatInput
            ref={inputRef}
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            isLoading={isLoading}
          />
        </footer>
      </div>

      {/* Search Modal */}
      <SearchModal
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        onSelectConversation={handleSelectConversation}
      />

      {/* Emergency Side Panel - Floating overlay, doesn't affect layout */}
      {activeEmergency && activeEmergency.severity !== "routine" && (
        <EmergencySidePanel
          assessment={activeEmergency}
          onDismiss={() => setActiveEmergency(null)}
        />
      )}

      {/* PDF Viewer Side Panel */}
      {pdfViewer && (
        <div className="fixed inset-y-0 right-0 w-[50vw] max-w-2xl bg-white dark:bg-slate-900 shadow-2xl z-50 flex flex-col border-l border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate pr-4">
              {pdfViewer.title}
            </h3>
            <div className="flex items-center gap-2">
              <a
                href={`${pdfViewer.url}${pdfViewer.url.includes('#') ? '&' : '#'}pagemode=none`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-teal-600 dark:text-teal-400 hover:underline"
              >
                Open in new tab
              </a>
              <button
                onClick={() => setPdfViewer(null)}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <iframe
            src={`${pdfViewer.url}${pdfViewer.url.includes('#') ? '&' : '#'}navpanes=0&pagemode=none`}
            className="flex-1 w-full"
            title={pdfViewer.title}
          />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// CHAT MESSAGE COMPONENT
// ════════════════════════════════════════════════════════════════════════════════

// Detect LLM-generated clarification messages and extract options
function detectInlineClarification(content: string): { detected: boolean; options: string[]; term: string; preamble: string } | null {
  // Pattern: "I noticed you used X which can mean..." followed by numbered list
  const patterns = [
    /I noticed you used [""']?(\w+)[""']?\s+which can mean several things[:\.]?\s*([\s\S]*?)(?:Which meaning|What did you mean|Please (?:select|specify|clarify))/i,
    /[""']?(\w+)[""']?\s+(?:can|could) (?:mean|refer to) (?:several|multiple|different) things[:\.]?\s*([\s\S]*?)(?:Which|What|Please)/i,
    /clarif(?:y|ication).*?[""']?(\w+)[""']?[\s\S]*?(?:options|meanings?)[:\.]?\s*([\s\S]*?)(?:Which|What|Please)/i,
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const term = match[1];
      const listText = match[2];
      
      // Extract numbered options (1. option, 2. option, etc.)
      const optionMatches = listText.match(/\d+\.\s*\*?\*?([^*\n]+)\*?\*?/g);
      if (optionMatches && optionMatches.length >= 2) {
        const options = optionMatches.map(opt => 
          opt.replace(/^\d+\.\s*\*?\*?/, '').replace(/\*?\*?\s*$/, '').trim()
        );
        return {
          detected: true,
          options,
          term,
          preamble: `What does "${term}" mean in this context?`
        };
      }
    }
  }
  return null;
}

function ChatMessage({
  message,
  sourcesExpanded,
  onToggleSources,
  onAbbreviationClarification,
  showConfidence = true,
  onPdfClick,
  onRetryTurn,
  onEditTurn,
  disableActions = false,
}: {
  message: Message;
  sourcesExpanded: boolean;
  onToggleSources: () => void;
  onAbbreviationClarification?: (meaning: string, abbreviation: string) => void;
  showConfidence?: boolean;
  onPdfClick?: (url: string, title: string) => void;
  onRetryTurn?: (assistantMessageId: string) => void;
  onEditTurn?: (userMessageId: string, editedContent: string) => void;
  disableActions?: boolean;
}) {
  const [showLegacyCitations, setShowLegacyCitations] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<"prompt" | "output" | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(
    async (text: string, target: "prompt" | "output") => {
      if (!text.trim() || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopiedTarget(target);
        if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = setTimeout(() => {
          setCopiedTarget(null);
          copyResetTimeoutRef.current = null;
        }, 1500);
      } catch {
        /* clipboard unavailable */
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isEditing) setEditDraft(message.content);
  }, [message.content, isEditing]);
  
  // Check for inline clarification in message content
  const inlineClarification = message.role === "assistant" && !message.needsAbbreviationClarification
    ? detectInlineClarification(message.content)
    : null;

  const getAvatarClass = () => {
    if (message.isError) return "bg-error-100 dark:bg-error-900/30";
    if (message.emergencyAssessment?.isEmergency) return "bg-emergency-100 dark:bg-emergency-900/30";
    if (message.emergencyAssessment?.severity === "urgent")
      return "bg-emergency-100 dark:bg-emergency-900/30";
    return "bg-brand-100 dark:bg-brand-900/30";
  };

  const getIconClass = () => {
    if (message.isError) return "text-error-600 dark:text-error-400";
    if (message.emergencyAssessment?.isEmergency) return "text-emergency-600 dark:text-emergency-400";
    if (message.emergencyAssessment?.severity === "urgent")
      return "text-emergency-600 dark:text-emergency-400";
    return "text-brand-600 dark:text-brand-400";
  };

  return (
    <div
      className={cn(
        "flex gap-3",
        message.role === "user" && "flex-row-reverse"
      )}
    >
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback
          className={cn(
            message.role === "assistant" ? getAvatarClass() : "bg-slate-100 dark:bg-slate-800"
          )}
        >
          {message.role === "assistant" ? (
            message.isError ? (
              <AlertTriangle className="h-4 w-4 text-error-600 dark:text-error-400" />
            ) : message.emergencyAssessment?.isEmergency ? (
              <AlertTriangle className={cn("h-4 w-4", getIconClass())} />
            ) : (
              <AppLogo size={18} variant="teal" />
            )
          ) : (
            <User className="h-4 w-4 text-slate-600 dark:text-slate-400" />
          )}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "flex flex-1 max-w-[85%] flex-col",
          message.role === "user" ? "items-end" : "items-start"
        )}
      >
        {/* Abbreviation Clarification UI - structured backend format */}
        {message.needsAbbreviationClarification &&
          message.abbreviation &&
          message.abbreviationOptions &&
          onAbbreviationClarification ? (
            <AbbreviationClarification
              abbreviation={message.abbreviation}
              options={message.abbreviationOptions}
              onSelect={(meaning) =>
                onAbbreviationClarification(meaning, message.abbreviation!)
              }
            />
          ) : inlineClarification && onAbbreviationClarification ? (
            /* Inline clarification detected in LLM response - render as clickable options */
            <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 space-y-3 shadow-sm">
              <p className="text-slate-700 dark:text-slate-200 text-sm font-medium">
                {inlineClarification.preamble}
              </p>
              <div className="grid gap-2">
                {inlineClarification.options.map((option, i) => (
                  <button
                    key={i}
                    onClick={() => onAbbreviationClarification(option, inlineClarification.term)}
                    className="text-left px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-700/50 hover:bg-teal-50 dark:hover:bg-teal-600/20 border border-slate-200 dark:border-slate-600 hover:border-teal-300 dark:hover:border-teal-500/50 transition-all text-sm group"
                  >
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-teal-100 dark:bg-teal-600/20 text-teal-700 dark:text-teal-400 text-xs font-bold mr-3 group-hover:bg-teal-200 dark:group-hover:bg-teal-600/30">
                      {i + 1}
                    </span>
                    <span className="text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white">{option}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message Content - chat bubbles per branding catalog */
            /* Note: Emergency display is now in the side panel, but message bubble styling still indicates severity */
            <>
              {message.role === "user" && isEditing ? (
                <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="space-y-3">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          if (editDraft.trim()) {
                            setIsEditing(false);
                            onEditTurn?.(message.id, editDraft);
                          }
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setIsEditing(false);
                          setEditDraft(message.content);
                        }
                      }}
                      className="w-full min-h-[120px] rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-3 py-2.5 text-[15px] leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-brand-400"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          setEditDraft(message.content);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (editDraft.trim()) {
                            setIsEditing(false);
                            onEditTurn?.(message.id, editDraft);
                          }
                        }}
                        disabled={!editDraft.trim()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-600 text-white text-xs hover:bg-brand-700 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Save & Regenerate
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className={cn(
                    "rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
                    message.role === "user"
                      // User bubble: slate-100 background
                      ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                      : message.isError
                      // Error bubble: red for system errors ONLY
                      ? "bg-error-50 dark:bg-error-700/20 text-error-700 dark:text-error-300 border border-error-200 dark:border-error-700"
                      : message.emergencyAssessment?.isEmergency
                      // Emergency bubble: amber background with amber border and glow
                      ? "bg-emergency-50 dark:bg-emergency-700/20 border border-emergency-300 dark:border-emergency-600 shadow-emergency"
                      : message.emergencyAssessment?.severity === "urgent"
                      // Urgent bubble: amber background
                      ? "bg-emergency-50 dark:bg-emergency-700/20 border border-emergency-200 dark:border-emergency-600"
                      // Standard assistant bubble: white with border
                      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm"
                  )}
                >
                  {message.role === "assistant" ? (
                    <Markdown
                      content={message.content}
                      className="text-sm"
                      sources={message.verbatimSources?.map((s) => ({
                        title: s.title,
                        url: s.url,
                        pageStart: s.pageStart,
                        pageEnd: s.pageEnd,
                        chunkIndex: s.chunkIndex,
                        content: s.content,
                        category: s.category,
                        institution: s.institution,
                        similarity: s.similarity,
                      }))}
                      onPdfClick={onPdfClick}
                      onCitationClick={(source) => {
                        if (source.url?.startsWith("/api/policies/")) {
                          if (onPdfClick) {
                            onPdfClick(source.url, source.title);
                          } else {
                            window.location.assign(source.url);
                          }
                          return;
                        }

                        if (!sourcesExpanded) {
                          onToggleSources();
                        }
                      }}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              )}

              {/* Action row: copy, edit (user) / copy, refresh (assistant) */}
              {!(message.role === "user" && isEditing) && (
                <div
                  className={cn(
                    "mt-1 flex items-center gap-2 px-1 text-xs text-slate-400 dark:text-slate-500",
                    message.role === "user" ? "self-end" : "self-start"
                  )}
                >
                  <span>
                    {message.timestamp.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <div className="flex items-center gap-1">
                    {message.role === "user" && onEditTurn && (
                      <button
                        onClick={() => {
                          setEditDraft(message.content);
                          setIsEditing(true);
                        }}
                        className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                        aria-label="Edit"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() =>
                        handleCopy(
                          message.content,
                          message.role === "user" ? "prompt" : "output"
                        )
                      }
                      className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                      aria-label={message.role === "user" ? "Copy prompt" : "Copy output"}
                      title="Copy"
                    >
                      {copiedTarget ===
                      (message.role === "user" ? "prompt" : "output") ? (
                        <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {message.role === "assistant" && onRetryTurn && (
                      <button
                        onClick={() => onRetryTurn(message.id)}
                        disabled={disableActions}
                        className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 disabled:opacity-50"
                        aria-label="Refresh"
                        title="Refresh"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

        {/* Verbatim Sources Panel */}
        {message.verbatimSources && message.verbatimSources.length > 0 && (
          <VerbatimSourcesPanel
            sources={message.verbatimSources}
            isExpanded={sourcesExpanded}
            onToggle={onToggleSources}
            onPdfClick={onPdfClick}
          />
        )}

        {/* Legacy Citations */}
        {!message.verbatimSources &&
          message.citations &&
          message.citations.length > 0 && (
            <div className="mt-2 w-full">
              <button
                onClick={() => setShowLegacyCitations(!showLegacyCitations)}
                className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <FileText className="h-3 w-3" />
                <span>{message.citations.length} sources</span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showLegacyCitations && "rotate-180"
                  )}
                />
              </button>
              {showLegacyCitations && (
                <div className="mt-2 space-y-2">
                  {message.citations.map((citation, i) => {
                    const pdfFilename =
                      citation.filename || `${citation.documentTitle}.pdf`;
                    // Add PDF viewer parameters: zoom=80% and hide sidebar
                    const pdfUrl = `/api/policies/${encodeURIComponent(
                      pdfFilename
                    )}#zoom=80&pagemode=none`;

                    return (
                      <Card key={i} className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <a
                                href={pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:underline flex items-center gap-1"
                              >
                                <span className="truncate">
                                  {citation.documentTitle}
                                  {citation.section && ` - ${citation.section}`}
                                </span>
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                              </a>
                              {citation.category && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] mt-1 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400"
                                >
                                  {citation.category}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                            {citation.relevantText}
                          </p>
                          {citation.similarity !== undefined && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                              Relevance: {Math.round(citation.similarity * 100)}%
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        {/* Confidence indicator and model info - respects user preference */}
        {(showConfidence && message.confidence !== undefined) || message.modelInfo?.fallbackUsed ? (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {showConfidence && message.confidence !== undefined && (
              <ConfidenceBadge confidence={message.confidence} />
            )}
            {message.modelInfo?.fallbackUsed && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                ⚠️ Used {message.modelInfo.provider} fallback
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
