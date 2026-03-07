import React, { useEffect, useRef, useState } from 'react';
import { Bot, AlertTriangle, Copy, Check, RotateCcw, Pencil, X } from 'lucide-react';
import { VerbatimSources } from './VerbatimSources';
import { Markdown } from './ui/markdown';
import type { Message } from '../stores/chat';
import { cn, formatRelativeTime, formatConfidence } from '../lib/utils';

interface ChatMessageProps {
  message: Message;
  onRetryTurn?: (assistantMessageId: string) => void;
  onEditTurn?: (userMessageId: string, editedContent: string) => void;
  disableActions?: boolean;
  relatedPromptContent?: string;
}

export function ChatMessage({
  message,
  onRetryTurn,
  onEditTurn,
  disableActions = false,
  relatedPromptContent,
}: ChatMessageProps) {
  const [copiedTarget, setCopiedTarget] = useState<'prompt' | 'output' | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUser = message.role === 'user';
  const isEmergency = message.emergencyAssessment?.isEmergency || message.emergencyAssessment?.severity === 'urgent';

  const handleCopy = async (text: string, target: 'prompt' | 'output') => {
    if (!text.trim()) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);

      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = setTimeout(() => {
        setCopiedTarget(null);
        copyResetTimeoutRef.current = null;
      }, 1500);
    } catch {
      // Clipboard access may be unavailable in restricted contexts.
    }
  };

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const startEdit = () => {
    setEditDraft(message.content);
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (!editDraft.trim()) return;
    onEditTurn?.(message.id, editDraft);
    setIsEditing(false);
  };

  // Strip thinking tags from content
  const processedContent = message.content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');

  return (
    <div
      className={cn('animate-fade-in', isUser ? 'flex justify-end' : 'flex justify-start')}
      data-related-prompt={!isUser ? relatedPromptContent : undefined}
    >
      <div className={cn('flex flex-col max-w-[90%]', isUser ? 'items-end' : 'items-start')}>
        {isUser && isEditing ? (
          <div className="w-full rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="space-y-2">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    if (editDraft.trim()) {
                      saveEdit();
                    }
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setIsEditing(false);
                  }
                }}
                className="w-full min-h-[140px] max-h-[420px] overflow-y-auto rounded-xl border border-gray-300 bg-white text-gray-800 px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-600 text-white hover:bg-teal-700 text-xs disabled:opacity-50"
                  disabled={!editDraft.trim()}
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
              'rounded-xl',
              isUser ? 'bg-teal-600 text-white px-4 py-2.5'
                : isEmergency ? 'bg-amber-50 border border-amber-200 px-4 py-3'
                : message.isError ? 'bg-red-50 border border-red-200 px-4 py-3'
                : 'bg-gray-50 border border-gray-100 px-4 py-3'
            )}
          >
            {!isUser && (
              <div className="flex items-center gap-2 mb-2">
                <div className={cn('w-6 h-6 rounded-full flex items-center justify-center', isEmergency ? 'bg-amber-200' : 'bg-teal-100')}>
                  {isEmergency ? <AlertTriangle className="w-3.5 h-3.5 text-amber-700" /> : <Bot className="w-3.5 h-3.5 text-teal-700" />}
                </div>
                <span className={cn('text-xs font-medium', isEmergency ? 'text-amber-700' : 'text-gray-600')}>
                  {isEmergency ? 'URGENT' : 'Protocol Assistant'}
                </span>
                {message.confidence !== undefined && !message.isError && (
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-xs font-medium',
                    message.confidence >= 0.7 ? 'bg-green-100 text-green-700'
                      : message.confidence >= 0.5 ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                  )}>
                    {formatConfidence(message.confidence)}
                  </span>
                )}
              </div>
            )}

            <div className={cn('text-sm', isUser ? 'text-white' : isEmergency ? 'text-amber-900' : message.isError ? 'text-red-700' : 'text-gray-800')}>
              {isUser ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <Markdown
                  content={processedContent}
                  className="max-w-none"
                  sources={message.verbatimSources?.map((source) => ({
                    title: source.title,
                    url: source.url,
                  }))}
                />
              )}
            </div>

            {!isUser && message.verbatimSources && message.verbatimSources.length > 0 && (
              <VerbatimSources sources={message.verbatimSources} defaultExpanded={isEmergency} />
            )}
          </div>
        )}

        {!isUser && (
          <div className="mt-1 flex items-center gap-1.5 px-1 text-xs text-gray-400">
            <span>{formatRelativeTime(message.timestamp)}</span>
            <button
              onClick={() => handleCopy(message.content, 'output')}
              className="inline-flex items-center justify-center p-1 rounded-md hover:bg-gray-200 text-gray-500"
              aria-label="Copy output"
              title="Copy output"
            >
              {copiedTarget === 'output' ? (
                <Check className="w-3.5 h-3.5 text-green-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            {onRetryTurn && (
              <button
                onClick={() => onRetryTurn(message.id)}
                className="inline-flex items-center justify-center p-1 rounded-md hover:bg-gray-200 text-gray-500 disabled:opacity-50"
                disabled={disableActions}
                aria-label="Refresh response"
                title="Refresh"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        {isUser && !isEditing && (
          <div className="mt-1 flex items-center gap-1.5 px-1 text-xs text-gray-400">
            <span>{formatRelativeTime(message.timestamp)}</span>
            <button
              onClick={startEdit}
              className="inline-flex items-center justify-center p-1 rounded-md hover:bg-gray-200 text-gray-500"
              aria-label="Edit prompt"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleCopy(message.content, 'prompt')}
              className="inline-flex items-center justify-center p-1 rounded-md hover:bg-gray-200 text-gray-500"
              aria-label="Copy prompt"
              title="Copy prompt"
            >
              {copiedTarget === 'prompt' ? (
                <Check className="w-3.5 h-3.5 text-green-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
