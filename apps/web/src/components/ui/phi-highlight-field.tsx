"use client";

import { useMemo, useRef } from "react";
import type { KeyboardEvent, RefObject, ReactNode } from "react";
import type { PHIDetectionSpan } from "@rad-assist/shared";
import { cn } from "@/lib/utils";

const TEXTAREA_TEXT_METRICS_CLASS = "text-[15px] leading-normal font-sans";
const TEXTAREA_TEXT_WRAP_CLASS = "whitespace-pre-wrap break-words";

interface HighlightSegment {
  text: string;
  span: PHIDetectionSpan | null;
}

function normalizeSpans(value: string, spans: PHIDetectionSpan[]): PHIDetectionSpan[] {
  return spans
    .filter((span) => span.start < span.end && span.start >= 0 && span.end <= value.length)
    .sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start));
}

function buildSegments(value: string, spans: PHIDetectionSpan[]): HighlightSegment[] {
  if (!value) return [{ text: "", span: null }];
  if (spans.length === 0) return [{ text: value, span: null }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const span of normalizeSpans(value, spans)) {
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      segments.push({ text: value.slice(cursor, span.start), span: null });
    }
    segments.push({ text: value.slice(span.start, span.end), span });
    cursor = span.end;
  }

  if (cursor < value.length) {
    segments.push({ text: value.slice(cursor), span: null });
  }

  return segments;
}

function HighlightedText(props: {
  value: string;
  spans: PHIDetectionSpan[];
  overriddenSpanIds: Set<string>;
  onOverrideSpan?: (span: PHIDetectionSpan) => void;
}) {
  const { value, spans, overriddenSpanIds, onOverrideSpan } = props;
  const segments = useMemo(() => buildSegments(value, spans), [value, spans]);

  return (
    <>
      {segments.map((segment, index) => {
        if (!segment.span) {
          return (
            <span
              key={`text-${index}`}
              className="font-sans text-slate-900 dark:text-slate-100"
            >
              {segment.text}
            </span>
          );
        }

        const overridden = overriddenSpanIds.has(segment.span.id);
        const canOverride = !overridden && Boolean(onOverrideSpan);

        return (
          <span
            key={segment.span.id}
            className={cn(
              "relative pointer-events-auto rounded-sm group font-sans",
              overridden
                ? "underline decoration-amber-500 decoration-2 underline-offset-2"
                : "underline decoration-red-500 decoration-2 underline-offset-2"
            )}
          >
            {segment.text}
            {canOverride && (
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (segment.span) {
                    onOverrideSpan?.(segment.span);
                  }
                }}
                className="absolute z-20 left-0 top-full mt-1 hidden whitespace-nowrap rounded-md border border-red-300 bg-white px-2 py-1 text-[11px] font-medium text-red-700 shadow group-hover:block dark:border-red-700 dark:bg-slate-900 dark:text-red-300"
              >
                Override PHI block
              </button>
            )}
            {overridden && (
              <span className="absolute z-20 left-0 top-full mt-1 hidden whitespace-nowrap rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-700 shadow group-hover:block dark:border-amber-700 dark:bg-slate-900 dark:text-amber-300">
                Override applied
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

interface PhiHighlightedInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  spans?: PHIDetectionSpan[];
  overriddenSpanIds?: Set<string>;
  onOverrideSpan?: (span: PHIDetectionSpan) => void;
  maxLength?: number;
}

export function PhiHighlightedInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  spans = [],
  overriddenSpanIds = new Set<string>(),
  onOverrideSpan,
  maxLength,
}: PhiHighlightedInputProps) {
  return (
    <div className={cn("relative group", className)}>
      {value.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center rounded-md px-3 py-2 text-sm leading-5"
        >
          <HighlightedText
            value={value}
            spans={spans}
            overriddenSpanIds={overriddenSpanIds}
            onOverrideSpan={onOverrideSpan}
          />
        </div>
      )}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
          value.length > 0 && "text-transparent caret-slate-900 dark:caret-slate-100"
        )}
      />
    </div>
  );
}

interface PhiHighlightedTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  maxLength?: number;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  className?: string;
  textareaClassName?: string;
  overlayClassName?: string;
  emptyOverlayContent?: ReactNode;
  spans?: PHIDetectionSpan[];
  overriddenSpanIds?: Set<string>;
  onOverrideSpan?: (span: PHIDetectionSpan) => void;
}

export function PhiHighlightedTextarea({
  value,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  placeholder,
  disabled,
  rows = 1,
  maxLength,
  textareaRef,
  className,
  textareaClassName,
  overlayClassName,
  emptyOverlayContent,
  spans = [],
  overriddenSpanIds = new Set<string>(),
  onOverrideSpan,
}: PhiHighlightedTextareaProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const overlayContentRef = useRef<HTMLDivElement>(null);
  const showOverlay = value.length > 0 || Boolean(emptyOverlayContent);

  return (
    <div className={cn("relative group", className)}>
      {showOverlay && (
        <div
          ref={overlayRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 overflow-hidden",
            TEXTAREA_TEXT_METRICS_CLASS,
            TEXTAREA_TEXT_WRAP_CLASS,
            overlayClassName
          )}
        >
          <div ref={overlayContentRef}>
            {value.length > 0 ? (
              <HighlightedText
                value={value}
                spans={spans}
                overriddenSpanIds={overriddenSpanIds}
                onOverrideSpan={onOverrideSpan}
              />
            ) : (
              emptyOverlayContent
            )}
          </div>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onScroll={(event) => {
          if (!overlayContentRef.current) return;
          overlayContentRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
        }}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
        className={cn(
          "w-full resize-none rounded-md border border-input bg-background ring-offset-background",
          TEXTAREA_TEXT_METRICS_CLASS,
          TEXTAREA_TEXT_WRAP_CLASS,
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          textareaClassName,
          value.length > 0 && "text-transparent caret-slate-900 dark:caret-slate-100"
        )}
      />
    </div>
  );
}
