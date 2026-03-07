"use client";

import { ArrowLeftRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiscrepancyType } from "@rad-assist/shared";

interface DiscrepancyAlertProps {
  discrepancyType: DiscrepancyType;
  summary: string;
  className?: string;
}

/**
 * Discrepancy type labels and descriptions
 */
const DISCREPANCY_LABELS: Record<DiscrepancyType, { label: string; description: string }> = {
  DOSING: {
    label: "Dosing Difference",
    description: "Different medication amounts specified",
  },
  TIMING: {
    label: "Timing Difference", 
    description: "Different schedules or intervals",
  },
  DRUG: {
    label: "Medication Difference",
    description: "Different drugs recommended",
  },
  THRESHOLD: {
    label: "Threshold Difference",
    description: "Different cutoff values (eGFR, age, etc.)",
  },
  PROCEDURE: {
    label: "Procedure Difference",
    description: "Different workflow steps",
  },
  CONTRAINDICATION: {
    label: "Contraindication Difference",
    description: "Different exclusion criteria",
  },
};

/**
 * Alert banner displayed when institutional policy discrepancy is detected.
 * Shows the type of discrepancy and a summary of the difference.
 */
export function DiscrepancyAlert({ 
  discrepancyType, 
  summary,
  className,
}: DiscrepancyAlertProps) {
  const typeInfo = DISCREPANCY_LABELS[discrepancyType] || {
    label: "Policy Difference",
    description: "Different guidance between institutions",
  };

  return (
    <div 
      className={cn(
        "mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl shadow-sm",
        className
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
          <ArrowLeftRight className="w-5 h-5 text-amber-600" aria-hidden="true" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header with badge */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-semibold text-amber-900">
              Institutional Policy Difference Detected
            </h3>
            <span 
              className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-amber-200 text-amber-800 rounded-full"
              title={typeInfo.description}
            >
              {typeInfo.label}
            </span>
          </div>

          {/* Summary */}
          <p className="text-sm text-amber-800 leading-relaxed">
            {summary}
          </p>

          {/* Warning */}
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" aria-hidden="true" />
            <p className="text-xs text-amber-700 font-medium">
              Verify which institution you are working at before proceeding
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DiscrepancyAlert;
