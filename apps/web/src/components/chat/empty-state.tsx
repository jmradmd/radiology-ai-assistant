"use client";

import { FileText, AlertCircle, Syringe } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppLogo } from "@/components/ui/app-logo";

interface EmptyStateProps {
  onExampleClick: (text: string) => void;
}

const EXAMPLE_QUERIES = [
  {
    icon: Syringe,
    text: "What is the contrast reaction protocol?",
    category: "CONTRAST",
  },
  {
    icon: AlertCircle,
    text: "MRI safety for patients with pacemakers",
    category: "MRI_SAFETY",
  },
  {
    icon: FileText,
    text: "eGFR threshold for IV contrast",
    category: "RENAL",
  },
];

export function EmptyState({ onExampleClick }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center w-full max-w-xl mx-auto px-4">
      {/* Main heading */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center mb-4">
          <AppLogo size={48} variant="teal" />
        </div>
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-2">
          What can I help you find?
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Ask about radiology protocols, contrast guidelines, or MRI safety
        </p>
      </div>

      {/* Example queries */}
      <div className="w-full space-y-3">
        {EXAMPLE_QUERIES.map((example, index) => (
          <button
            key={index}
            onClick={() => onExampleClick(example.text)}
            className={cn(
              "w-full flex items-center gap-4 px-5 py-4 rounded-2xl",
              "bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700/90",
              "border border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600",
              "text-left transition-all duration-150 shadow-sm",
              "group"
            )}
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-600/50 flex items-center justify-center group-hover:border-teal-400 dark:group-hover:border-teal-500/50 group-hover:bg-teal-50 dark:group-hover:bg-teal-900/30 transition-colors">
              <example.icon className="w-5 h-5 text-slate-500 dark:text-slate-400 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors" />
            </div>
            <span className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">
              {example.text}
            </span>
          </button>
        ))}
      </div>

      {/* Safety note */}
      <p className="mt-8 text-xs text-slate-400 dark:text-slate-500 text-center">
        Always verify AI responses against source documents for clinical decisions
      </p>
    </div>
  );
}
