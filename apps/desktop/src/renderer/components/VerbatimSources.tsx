import React, { useState } from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { cn, formatConfidence, getInstitutionInfo, truncate } from '../lib/utils';
import { APP_BASE_URL } from '../lib/constants';

interface VerbatimSource {
  title: string;
  content: string;
  category: string;
  institution?: string;
  similarity: number;
  url: string | null;
}

interface VerbatimSourcesProps {
  sources: VerbatimSource[];
  defaultExpanded?: boolean;
}

function isInternalPolicyUrl(url: string): boolean {
  return url.startsWith('/api/policies/');
}

export function VerbatimSources({ sources, defaultExpanded = false }: VerbatimSourcesProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!sources?.length) return null;

  return (
    <div className="mt-3 border-t border-gray-200 pt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between py-1 text-xs font-medium text-gray-500 hover:text-gray-700"
      >
        <span className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" />
          {sources.length} source{sources.length !== 1 ? 's' : ''} cited
        </span>
        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {sources.map((src, i) => {
            const info = getInstitutionInfo(src.institution || null);
            return (
              <div key={i} className="rounded-lg bg-white border border-gray-200 overflow-hidden">
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    {src.url && isInternalPolicyUrl(src.url) ? (
                      <button
                        type="button"
                        onClick={() => window.electron.openExternal(`${APP_BASE_URL}${src.url}`)}
                        className="text-sm font-medium truncate text-gray-900 hover:text-teal-600 cursor-pointer"
                      >
                        {src.title}
                      </button>
                    ) : (
                      <span className="text-sm font-medium truncate text-gray-900">
                        {src.title}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={cn('px-1.5 py-0.5 rounded font-medium', info.bgColor, info.color)}>{info.shortName}</span>
                    <span className="text-gray-400">{formatConfidence(src.similarity)} match</span>
                  </div>
                </div>
                <div className="px-3 pb-2">
                  <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {expandedIdx === i ? src.content : truncate(src.content, 200)}
                  </p>
                  {src.content.length > 200 && (
                    <button onClick={() => setExpandedIdx(expandedIdx === i ? null : i)} className="text-xs text-teal-600 hover:underline mt-1">
                      {expandedIdx === i ? 'Show less' : 'Show more'}
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
