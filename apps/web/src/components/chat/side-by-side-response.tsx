"use client";

import { useState } from "react";
import { Building2, GraduationCap, FileText, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import type { Institution, InstitutionalResponse, VerbatimSource } from "@rad-assist/shared";
import { INSTITUTION_CONFIG } from "@rad-assist/shared";

interface SideBySideResponseProps {
  institutionAResponse: InstitutionalResponse;
  institutionBResponse: InstitutionalResponse;
  className?: string;
  onCitationClick?: (source: VerbatimSource) => void;
}

/**
 * Configuration for institution-specific styling
 */
const INSTITUTION_UI_CONFIG = {
  INSTITUTION_A: {
    icon: Building2,
    colors: {
      bg: "bg-blue-50",
      border: "border-blue-200",
      header: "bg-blue-100",
      headerBorder: "border-blue-200",
      text: "text-blue-900",
      textMuted: "text-blue-700",
      accent: "text-blue-600",
      badge: "bg-blue-200 text-blue-800",
    },
  },
  INSTITUTION_B: {
    icon: GraduationCap,
    colors: {
      bg: "bg-rose-50",
      border: "border-rose-200",
      header: "bg-rose-100",
      headerBorder: "border-rose-200",
      text: "text-rose-900",
      textMuted: "text-rose-700",
      accent: "text-rose-600",
      badge: "bg-rose-200 text-rose-800",
    },
  },
} as const;

function normalizeSourceTitle(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[“”‘’]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Confidence badge component
 */
function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percentage = Math.round(confidence * 100);
  
  let colorClass: string;
  if (confidence >= 0.7) {
    colorClass = "bg-green-100 text-green-700";
  } else if (confidence >= 0.5) {
    colorClass = "bg-amber-100 text-amber-700";
  } else {
    colorClass = "bg-slate-100 text-slate-600";
  }
  
  return (
    <span className={cn("text-xs px-2 py-1 rounded-full font-medium", colorClass)}>
      {percentage}% confidence
    </span>
  );
}

/**
 * Verbatim sources panel for a single institution
 */
function SourcesPanel({ 
  sources, 
  institution,
  onCitationClick,
}: { 
  sources: VerbatimSource[];
  institution: Institution;
  onCitationClick?: (source: VerbatimSource) => void;
}) {
  const [expandedSource, setExpandedSource] = useState<number | null>(null);
  const config = INSTITUTION_UI_CONFIG[institution === "SHARED" ? "INSTITUTION_A" : institution];
  
  if (sources.length === 0) {
    return (
      <p className="text-xs text-slate-500 italic">No source documents available</p>
    );
  }
  
  return (
    <div className="space-y-2">
      {sources.map((source, idx) => {
        const isExpanded = expandedSource === idx;
        const content = source.content;
        const shouldTruncate = content.length > 300;
        const displayContent = isExpanded || !shouldTruncate 
          ? content 
          : content.slice(0, 300) + "...";
        
        return (
          <div
            key={idx}
            className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm"
          >
            {/* Source header */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="text-sm font-medium text-slate-700 truncate">
                  {source.title}
                </span>
              </div>
              {(source.url?.startsWith("/api/policies/") || !!source.content) && (
                <button
                  type="button"
                  onClick={() => onCitationClick?.(source)}
                  className="flex-shrink-0 p-1 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Open cited source"
                >
                  <ExternalLink className="w-4 h-4 text-slate-400" />
                </button>
              )}
            </div>
            
            {/* Source content */}
            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
              {displayContent}
            </p>
            
            {/* Expand/collapse button */}
            {shouldTruncate && (
              <button
                onClick={() => setExpandedSource(isExpanded ? null : idx)}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    Show more
                  </>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Single institution column in the side-by-side view
 */
function InstitutionColumn({
  response,
  onCitationClick,
}: {
  response: InstitutionalResponse;
  onCitationClick?: (source: VerbatimSource) => void;
}) {
  const institution = response.institution;
  const uiConfig = INSTITUTION_UI_CONFIG[institution === "SHARED" ? "INSTITUTION_A" : institution];
  const institutionConfig = INSTITUTION_CONFIG[institution];
  const Icon = uiConfig.icon;
  
  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden flex flex-col",
        uiConfig.colors.bg,
        uiConfig.colors.border
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "px-4 py-3 flex items-center gap-2 border-b",
          uiConfig.colors.header,
          uiConfig.colors.headerBorder
        )}
      >
        <Icon className={cn("w-5 h-5", uiConfig.colors.accent)} aria-hidden="true" />
        <span className={cn("font-semibold", uiConfig.colors.text)}>
          {institutionConfig.displayName}
        </span>
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col">
        {/* AI Summary */}
        <div className="max-w-none mb-4 flex-1">
          <Markdown
            content={response.summary}
            className={cn("text-sm leading-relaxed", uiConfig.colors.textMuted)}
            sources={response.verbatimSources}
            onCitationClick={(source) => {
              const normalizedTitle = normalizeSourceTitle(source.title);
              const matched =
                response.verbatimSources.find(
                  (candidate) =>
                    normalizeSourceTitle(candidate.title) === normalizedTitle
                ) || response.verbatimSources[0];

              if (!matched) return;
              onCitationClick?.(matched);
            }}
          />
        </div>

        {/* Key Points (if available) */}
        {response.keyPoints && response.keyPoints.length > 0 && (
          <div className="mb-4 p-3 bg-white/50 rounded-lg border border-white/80">
            <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
              Key Points
            </h4>
            <ul className="space-y-1">
              {response.keyPoints.map((point, idx) => (
                <li key={idx} className="text-xs text-slate-700 flex items-start gap-2">
                  <span className="text-slate-400 mt-0.5">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Verbatim Sources */}
        {response.verbatimSources.length > 0 && (
          <div className="mt-auto pt-4 border-t border-slate-200/50">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Source Documents
            </h4>
            <SourcesPanel
              sources={response.verbatimSources}
              institution={institution}
              onCitationClick={onCitationClick}
            />
          </div>
        )}

        {/* Confidence Badge */}
        <div className="mt-4 flex items-center justify-end">
          <ConfidenceBadge confidence={response.confidence} />
        </div>
      </div>
    </div>
  );
}

/**
 * Side-by-side response display for institutional discrepancies.
 * Shows Institution A and Institution B responses in two columns with their respective
 * styling and source documents.
 */
export function SideBySideResponse({
  institutionAResponse,
  institutionBResponse,
  className,
  onCitationClick,
}: SideBySideResponseProps) {
  return (
    <div 
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 gap-4",
        className
      )}
    >
      {/* Institution A Column */}
      <InstitutionColumn response={institutionAResponse} onCitationClick={onCitationClick} />

      {/* Institution B Column */}
      <InstitutionColumn response={institutionBResponse} onCitationClick={onCitationClick} />
    </div>
  );
}

export default SideBySideResponse;
