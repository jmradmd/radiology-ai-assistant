import React from 'react';
import { Sparkles } from 'lucide-react';

interface EmptyStateProps {
  onExampleClick: (example: string) => void;
}

export function EmptyState({ onExampleClick }: EmptyStateProps) {
  return (
    <div className="h-full w-full max-w-md mx-auto flex flex-col px-4 py-6">
      {/* Centered Logo */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500/40 to-teal-600/40 dark:from-teal-500/20 dark:to-teal-600/20 flex items-center justify-center transition-all duration-500 hover:from-teal-500/60 hover:to-teal-600/60 dark:hover:from-teal-500/40 dark:hover:to-teal-600/40">
          <Sparkles className="w-8 h-8 text-teal-700/50 dark:text-teal-400/50 transition-colors duration-500" />
        </div>
      </div>

      {/* Bottom-anchored Safety note */}
      <div className="mt-auto pb-2">
        <p className="text-[13px] text-gray-400 dark:text-gray-500 text-center">
          Always verify AI responses against source documents for clinical decisions
        </p>
      </div>
    </div>
  );
}
