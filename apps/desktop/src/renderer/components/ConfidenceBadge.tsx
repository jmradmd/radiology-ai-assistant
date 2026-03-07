import React from 'react';
import { cn, formatConfidence } from '../lib/utils';

interface ConfidenceBadgeProps {
  confidence: number;
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  // Normalize confidence to 0-1 range
  const normalized = confidence > 1 ? confidence / 100 : confidence;

  // Color coding based on confidence level
  const color =
    normalized >= 0.7
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      : normalized >= 0.5
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-400';

  return (
    <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium', color)}>
      {formatConfidence(confidence)}
    </span>
  );
}
