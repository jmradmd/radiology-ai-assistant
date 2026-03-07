"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, X, MessageSquare, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { formatDistanceToNow } from "date-fns";
import { useAuthStore } from "@/stores/auth";

interface Conversation {
  id: string;
  title: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (conversationId: string) => void;
}

export function SearchModal({
  isOpen,
  onClose,
  onSelectConversation,
}: SearchModalProps) {
  const router = useRouter();
  const { logout, isHydrated, isAuthenticated } = useAuthStore();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<"auth" | "general" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const utils = trpc.useUtils();

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch conversations manually (avoids react-query version issues)
  const fetchConversations = useCallback(async () => {
    if (!isHydrated) return;
    
    if (!isOpen || debouncedQuery.length === 0) {
      setConversations([]);
      setLoadError(null);
      return;
    }

    if (!isAuthenticated) {
      setConversations([]);
      setLoadError("auth");
      return;
    }
    
    setIsLoading(true);
    try {
      const data = await utils.conversation.listRagChats.fetch({
        search: debouncedQuery,
        limit: 10,
      });
      setConversations(data?.conversations || []);
      setLoadError(null);
    } catch (err: unknown) {
      console.error('[SearchModal] Failed to search conversations:', err);
      // Handle auth errors
      const error = err as { data?: { code?: string }; message?: string };
      if (error?.data?.code === "UNAUTHORIZED" || error?.message?.includes("logged in")) {
        setLoadError("auth");
        logout();
        router.replace("/login");
        return;
      }
      setLoadError("general");
      setConversations([]);
    } finally {
      setIsLoading(false);
    }
  }, [
    debouncedQuery,
    isAuthenticated,
    isHydrated,
    isOpen,
    logout,
    router,
    utils.conversation.listRagChats,
  ]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setDebouncedQuery("");
    }
  }, [isOpen]);

  // Keyboard shortcut to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Modal */}
      <div role="dialog" aria-modal="true" aria-label="Search conversations" className="fixed inset-x-4 top-[20%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-lg z-50 animate-in fade-in duration-100">
        <div className="bg-white dark:bg-slate-950 rounded-xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <Search className="w-5 h-5 text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations..."
              className="flex-1 text-base outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-transparent text-slate-900 dark:text-slate-100 focus-visible:ring-0"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              </button>
            )}
            <kbd className="hidden md:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 rounded-md border border-slate-200 dark:border-slate-800/60 shadow-sm dark:shadow-none">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {query.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                <Search className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-medium">Type to search your conversations</p>
              </div>
            ) : isLoading ? (
              <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                <div className="w-6 h-6 border-2 border-slate-200 dark:border-slate-700 border-t-teal-500 dark:border-t-brand-400 rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm">Searching...</p>
              </div>
            ) : loadError === "auth" ? (
              <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                <p className="text-sm">Session expired. Please sign in again.</p>
              </div>
            ) : loadError === "general" ? (
              <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400 space-y-2">
                <p className="text-sm">Could not load conversation history.</p>
                <button
                  onClick={fetchConversations}
                  className="text-xs text-teal-600 dark:text-teal-400 hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : conversations?.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                <p className="text-sm">No conversations found</p>
              </div>
            ) : (
              <ul className="py-2">
                {conversations?.map((conv) => (
                  <li key={conv.id}>
                    <button
                      onClick={() => {
                        onSelectConversation(conv.id);
                        onClose();
                      }}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors text-left"
                    >
                      <MessageSquare className="w-5 h-5 text-slate-500 dark:text-slate-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {conv.title || "Untitled conversation"}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(conv.updatedAt), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
