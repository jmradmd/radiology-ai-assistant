"use client";

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { ArrowUp, AlertTriangle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  detectPotentialPHI,
  getUnresolvedBlockingSpans,
  type PHIOverrideSelection,
  type PHIDetectionSpan,
} from "@rad-assist/shared";
import { PhiHighlightedTextarea } from "@/components/ui/phi-highlight-field";
import { LoadingIndicator } from "@/components/chat/loading-indicator";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (options?: { phiOverrides?: PHIOverrideSelection[] }) => void;
  isLoading: boolean;
  placeholder?: string;
}

const STATIC_PLACEHOLDER_PREFIX = "Ask about ";
const INPUT_TEXT_METRICS_CLASS =
  "text-[15px] leading-[24px] font-sans tracking-normal p-0 m-0 border-0 outline-none block";
const INPUT_TEXT_WRAP_CLASS = "whitespace-pre-wrap break-words";

function splitPlaceholder(text: string) {
  if (text.startsWith(STATIC_PLACEHOLDER_PREFIX)) {
    return {
      prefix: STATIC_PLACEHOLDER_PREFIX,
      suffix: text.slice(STATIC_PLACEHOLDER_PREFIX.length),
    };
  }
  return { prefix: "", suffix: text };
}

export interface ChatInputHandle {
  focus: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = "Ask a protocol question...",
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));
  const [isFocused, setIsFocused] = useState(false);
  const [overriddenSpanIds, setOverriddenSpanIds] = useState<Set<string>>(
    new Set(),
  );

  // Two elements overlap: outgoing fades out while incoming fades in.
  const initial = splitPlaceholder(placeholder);
  const [prefix, setPrefix] = useState(initial.prefix);
  const [currentSuffix, setCurrentSuffix] = useState(initial.suffix);
  const [prevSuffix, setPrevSuffix] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const currentSuffixRef = useRef(initial.suffix);
  const animTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const next = splitPlaceholder(placeholder);
    setPrefix(next.prefix);

    if (next.suffix === currentSuffixRef.current) return;

    setPrevSuffix(currentSuffixRef.current);
    setCurrentSuffix(next.suffix);
    currentSuffixRef.current = next.suffix;
    setAnimKey((k) => k + 1);

    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => setPrevSuffix(null), 1050);

    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, [placeholder]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (!value) {
      textarea.style.height = "24px";
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [value]);

  // Handle submit on Enter (without shift)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSubmit) {
        handleSubmit();
      }
    }
  };

  const phiResult = value ? detectPotentialPHI(value) : null;
  const blockedSpans = phiResult?.detectionSpans ?? [];
  const overrideSelections: PHIOverrideSelection[] = blockedSpans
    .filter((span) => overriddenSpanIds.has(span.id))
    .map((span) => ({
      spanId: span.id,
      type: span.type,
      inputHash: phiResult?.inputHash ?? "",
      acknowledged: true,
    }));
  const unresolvedSpans = phiResult
    ? getUnresolvedBlockingSpans(phiResult, overrideSelections)
    : [];
  const isBlocked = unresolvedSpans.length > 0;
  const hasWarning = phiResult?.hasWarning ?? false;
  const canSubmit = value.trim().length > 0 && !isLoading && !isBlocked;

  useEffect(() => {
    const currentSpanIds = new Set(blockedSpans.map((span) => span.id));
    setOverriddenSpanIds((prev) => {
      const next = new Set([...prev].filter((id) => currentSpanIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [phiResult?.inputHash]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOverrideSpan = (span: PHIDetectionSpan) => {
    setOverriddenSpanIds((prev) => {
      const next = new Set(prev);
      next.add(span.id);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(
      overrideSelections.length > 0
        ? { phiOverrides: overrideSelections }
        : undefined,
    );
  };

  return (
    <div className="relative max-w-xl mx-auto w-full">
      {/* BLOCKED - unresolved PHI spans */}
      {isBlocked && (
        <div className="absolute bottom-full left-0 right-0 mb-2 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-red-100 dark:bg-red-900/50 rounded-full flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                Protected Health Information Detected
              </p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">
                {phiResult?.summary} Hover over each red-underlined item and
                override if intentional ({unresolvedSpans.length} remaining).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* WARNING - Re-identification risk (Amber) - can still send */}
      {!isBlocked && hasWarning && (
        <div className="absolute bottom-full left-0 right-0 mb-2 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-amber-100 dark:bg-amber-900/50 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Re-identification Risk
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">{phiResult?.summary}</p>
            </div>
          </div>
        </div>
      )}

      {/* Input Container */}
      <div
        className={cn(
          "relative flex items-center gap-2 px-3 py-2.5 rounded-2xl border-2 transition-all duration-200",
          isFocused
            ? "border-teal-500 bg-white dark:bg-slate-900"
            : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600",
          isBlocked && "border-red-500",
          !isBlocked && hasWarning && "border-amber-500"
        )}
      >
        <div className="relative flex-1">
          <PhiHighlightedTextarea
            textareaRef={textareaRef}
            value={value}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder=""
            rows={1}
            spans={blockedSpans}
            overriddenSpanIds={overriddenSpanIds}
            onOverrideSpan={handleOverrideSpan}
            className="flex-1"
            overlayClassName={cn(
              INPUT_TEXT_METRICS_CLASS,
              INPUT_TEXT_WRAP_CLASS,
            )}
            textareaClassName={cn(
              "resize-none bg-transparent",
              INPUT_TEXT_METRICS_CLASS,
              INPUT_TEXT_WRAP_CLASS,
              "placeholder:text-transparent",
              "text-slate-900 dark:text-slate-100",
              "max-h-[120px]",
              "!rounded-none !border-0 !shadow-none !outline-none !ring-0 !ring-offset-0",
              "focus-visible:!outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0",
            )}
          />

          {/* Animated placeholder overlay */}
          {value.length === 0 && (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 overflow-hidden whitespace-nowrap text-slate-400 dark:text-slate-500",
                INPUT_TEXT_METRICS_CLASS,
              )}
            >
              <span className="flex-shrink-0">
                {prefix.trimEnd()}
                {prefix ? "\u00A0" : ""}
              </span>
              <span className="relative inline-block">
                <span className="invisible whitespace-nowrap">
                  {currentSuffix}
                </span>
                {prevSuffix !== null && (
                  <span
                    key={`exit-${animKey}`}
                    className="absolute left-0 top-0 whitespace-nowrap animate-placeholder-exit"
                  >
                    {prevSuffix}
                  </span>
                )}
                <span
                  key={`enter-${animKey}`}
                  className={cn(
                    "absolute left-0 top-0 whitespace-nowrap",
                    prevSuffix !== null ? "animate-placeholder-enter" : "",
                  )}
                >
                  {currentSuffix}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150",
            canSubmit
              ? "bg-slate-800 dark:bg-slate-700 text-brand-400 border border-slate-600 dark:border-slate-500 hover:bg-slate-700 dark:hover:bg-slate-600 hover:text-brand-300 active:scale-95"
              : "bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed"
          )}
        >
          {isLoading ? (
            <LoadingIndicator compact />
          ) : (
            <ArrowUp className="w-4 h-4" />
          )}
        </button>
      </div>

    </div>
  );
});
