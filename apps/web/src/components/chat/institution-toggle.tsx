"use client";

import { Building2, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Institution } from "@rad-assist/shared";

interface InstitutionToggleProps {
  selected: Institution | null;
  onChange: (institution: Institution | null) => void;
  disabled?: boolean;
}

export function InstitutionToggle({
  selected,
  onChange,
  disabled = false,
}: InstitutionToggleProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-slate-100/80 dark:bg-slate-800/50 p-[3px] border border-slate-200/60 dark:border-transparent w-full">
      {/* All Sites */}
      <button
        onClick={() => onChange(null)}
        disabled={disabled}
        className={cn(
          "px-2 py-1 flex-1 text-[11px] font-medium rounded-full transition-all",
          selected === null
            ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        All Sites
      </button>

      {/* Institution A */}
      <button
        onClick={() => onChange("INSTITUTION_A")}
        disabled={disabled}
        className={cn(
          "flex items-center justify-center gap-1 px-2 py-1 flex-1 text-[11px] font-medium rounded-full transition-all",
          selected === "INSTITUTION_A"
            ? "bg-blue-600 text-white shadow-sm"
            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <Building2 className="w-3 h-3" />
        Hosp A
      </button>

      {/* Institution B */}
      <button
        onClick={() => onChange("INSTITUTION_B")}
        disabled={disabled}
        className={cn(
          "flex items-center justify-center gap-1 px-2 py-1 flex-1 text-[11px] font-medium rounded-full transition-all",
          selected === "INSTITUTION_B"
            ? "bg-red-600 text-white shadow-sm"
            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <GraduationCap className="w-3 h-3" />
        Dept
      </button>
    </div>
  );
}
