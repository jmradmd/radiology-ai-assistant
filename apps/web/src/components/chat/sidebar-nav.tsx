"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  PenSquare,
  Search,
  ChevronLeft,
  MessageSquare,
  Trash2,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { AppLogo } from "@/components/ui/app-logo";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { formatDistanceToNow } from "date-fns";
import { SettingsPanel } from "./settings-panel";
import { useAuthStore } from "@/stores/auth";

interface Conversation {
  id: string;
  title: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface SidebarNavProps {
  onNewChat: () => void;
  onOpenSearch: () => void;
  onSelectConversation: (id: string) => void;
  currentConversationId: string | null;
}

export function SidebarNav({
  onNewChat,
  onOpenSearch,
  onSelectConversation,
  currentConversationId,
}: SidebarNavProps) {
  const router = useRouter();
  const { logout, isHydrated, isAuthenticated } = useAuthStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<"auth" | "general" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  const utils = trpc.useUtils();

  // Fetch recent conversations
  const fetchConversations = useCallback(async () => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      setConversations([]);
      setLoadError("auth");
      return;
    }

    setIsLoading(true);
    try {
      const data = await utils.conversation.listRagChats.fetch({
        limit: 20,
      });
      setConversations(data?.conversations || []);
      setLoadError(null);
    } catch (err) {
      const error = err as { data?: { code?: string }; message?: string };
      if (error?.data?.code === "UNAUTHORIZED") {
        setLoadError("auth");
        logout();
        router.replace("/login");
        return;
      }

      setConversations([]);
      setLoadError("general");
      console.error("Failed to fetch conversations:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, isHydrated, logout, router, utils.conversation.listRagChats]);

  // Fetch on mount and when conversation changes
  useEffect(() => {
    if (!isHydrated) return;
    fetchConversations();
  }, [fetchConversations, currentConversationId, isHydrated]);

  const deleteMutation = trpc.conversation.delete.useMutation({
    onSuccess: () => fetchConversations(),
  });

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Delete this conversation?")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <>
      {/* Desktop Sidebar - Clean design with light/dark support */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "hidden md:block bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 ease-out h-full overflow-hidden z-20 cursor-pointer",
          isExpanded ? "w-64" : "w-16"
        )}
      >
        <div className="flex flex-col w-64 h-full">
          {/* Logo/Brand - Click to toggle */}
          <div className="p-2 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className={cn(
                "flex items-center gap-3 p-2 rounded-2xl transition-all duration-300 group hover:bg-black/5 dark:hover:bg-white/5 justify-start overflow-hidden",
                isExpanded ? "w-full" : "w-12"
              )}
            >
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                <AppLogo size={28} variant="teal" className="flex-shrink-0" />
              </div>
              <div
                className={cn(
                  "flex items-center flex-1 min-w-0 transition-opacity duration-300",
                  isExpanded ? "opacity-100" : "opacity-0"
                )}
              >
                <span className="font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                  Radiology AI Assistant
                </span>
                <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-slate-400 ml-auto group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              </div>
            </button>
          </div>

          {/* Action Buttons */}
          <div className="px-2 space-y-1 flex-shrink-0">
            {/* New Chat */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onNewChat();
              }}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all duration-300 overflow-hidden justify-start",
                "text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-500/10",
                isExpanded ? "w-full" : "w-12"
              )}
              title={!isExpanded ? "New Chat" : undefined}
            >
              <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                <PenSquare className="w-5 h-5" />
              </div>
              <span
                className={cn(
                  "text-sm font-medium whitespace-nowrap transition-opacity duration-300",
                  isExpanded ? "opacity-100" : "opacity-0"
                )}
              >
                New Chat
              </span>
            </button>

            {/* Search */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenSearch();
              }}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all duration-300 overflow-hidden justify-start",
                "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-black/5 dark:hover:bg-white/5",
                isExpanded ? "w-full" : "w-12"
              )}
              title={!isExpanded ? "Search" : undefined}
            >
              <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                <Search className="w-5 h-5" />
              </div>
              <span
                className={cn(
                  "text-sm font-medium whitespace-nowrap transition-opacity duration-300",
                  isExpanded ? "opacity-100" : "opacity-0"
                )}
              >
                Search
              </span>
            </button>
          </div>

          {/* Recent Chats - Fade out when collapsed */}
          <div
            className={cn(
              "flex-1 mt-4 overflow-hidden flex flex-col min-h-0 transition-opacity duration-300",
              isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <div className="px-4 mb-2 flex-shrink-0">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Recent
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-transparent">
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500 dark:text-slate-400" />
                </div>
              ) : loadError === "auth" ? (
                <div className="py-8 text-center px-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Session expired. Please sign in again.
                  </p>
                </div>
              ) : loadError === "general" ? (
                <div className="py-8 text-center px-3 space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Could not load conversations.
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      fetchConversations();
                    }}
                    className="text-xs text-teal-600 dark:text-teal-400 hover:underline"
                  >
                    Try again
                  </button>
                </div>
              ) : conversations.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                    <MessageSquare className="w-5 h-5 text-slate-400 dark:text-slate-600" />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">No conversations yet</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectConversation(conv.id);
                      }}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-left transition-all duration-300 group overflow-hidden",
                        currentConversationId === conv.id
                          ? "bg-teal-50 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300"
                          : "text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-100",
                        isExpanded ? "w-full" : "w-12"
                      )}
                    >
                      <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                        <MessageSquare className="w-4 h-4 opacity-60" />
                      </div>
                      <div className={cn(
                        "flex-1 min-w-0 transition-opacity duration-300",
                        isExpanded ? "opacity-100" : "opacity-0"
                      )}>
                        <p className="text-[13px] font-medium truncate">{conv.title}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {formatDistanceToNow(new Date(conv.updatedAt), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, conv.id)}
                        className={cn(
                          "p-1.5 rounded-xl transition-all",
                          isExpanded ? "opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-500/20 hover:text-red-600 dark:hover:text-red-400" : "opacity-0 pointer-events-none"
                        )}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bottom - Settings */}
          <div
            className={cn(
              "mt-auto flex-shrink-0 flex flex-col pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            )}
          >
            <div className="px-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSettings(!showSettings);
                }}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all duration-300 justify-start overflow-hidden",
                  "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-black/5 dark:hover:bg-white/5",
                  showSettings && "bg-black/5 dark:bg-white/10 text-slate-800 dark:text-slate-100",
                  isExpanded ? "w-full" : "w-12"
                )}
                title={!isExpanded ? "Settings" : undefined}
              >
                <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                  <SlidersHorizontal className="w-5 h-5" />
                </div>
                <span
                  className={cn(
                    "text-sm font-medium whitespace-nowrap transition-opacity duration-300",
                    isExpanded ? "opacity-100" : "opacity-0"
                  )}
                >
                  Settings
                </span>
              </button>

              <div onClick={(e) => e.stopPropagation()} className="cursor-default">
                <SettingsPanel
                  isOpen={showSettings}
                  onClose={() => setShowSettings(false)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
