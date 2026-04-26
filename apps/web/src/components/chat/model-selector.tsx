"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Sparkles, Brain, Zap, Check, Cpu, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { LLM_MODELS, type LLMModelConfig } from "@rad-assist/shared";
import { usePreferencesStore, type ModelId } from "@/stores/preferences";
import { trpc } from "@/lib/trpc/client";

function buildLocalOption(modelId: string): LLMModelConfig {
  return {
    id: modelId,
    name: modelId,
    provider: "local",
    modelId,
    description: "Local model",
    contextWindow: 32000,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  };
}

// Icon mapping for each provider
const PROVIDER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  deepseek: Brain,
  moonshot: Sparkles,
  anthropic: Zap,
  openai: Zap,
  gemini: Sparkles,
  minimax: Cpu,
  local: Monitor,
};

// Provider colors for visual distinction
const PROVIDER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  deepseek: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200/50 dark:border-blue-600/40",
  },
  moonshot: {
    bg: "bg-violet-50 dark:bg-violet-900/20",
    text: "text-violet-700 dark:text-violet-300",
    border: "border-violet-200/50 dark:border-violet-600/40",
  },
  anthropic: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200/50 dark:border-amber-600/40",
  },
  openai: {
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200/50 dark:border-emerald-600/40",
  },
  gemini: {
    bg: "bg-indigo-50 dark:bg-indigo-900/20",
    text: "text-indigo-700 dark:text-indigo-300",
    border: "border-indigo-200/50 dark:border-indigo-600/40",
  },
  minimax: {
    bg: "bg-fuchsia-50 dark:bg-fuchsia-900/20",
    text: "text-fuchsia-700 dark:text-fuchsia-300",
    border: "border-fuchsia-200/50 dark:border-fuchsia-600/40",
  },
  local: {
    bg: "bg-slate-50 dark:bg-slate-900/30",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-300/50 dark:border-slate-500/40",
  },
};

interface ModelSelectorProps {
  disabled?: boolean;
}

export function ModelSelector({ disabled = false }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [dropdownMaxHeight, setDropdownMaxHeight] = useState<number | null>(null);
  const { selectedModelId, setSelectedModelId } = usePreferencesStore();

  // Same query options as ConfigBanner so TanStack Query dedupes by query key.
  // No second polling loop is started — both observers share the cache entry.
  const healthCheck = trpc.system.healthCheck.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const { localOptions, cloudOptions, displayModels } = useMemo(() => {
    const discovered = healthCheck.data?.localModels?.chatModels ?? [];
    const cloud = LLM_MODELS.filter((m) => m.provider !== "local");
    const local: LLMModelConfig[] = discovered.length > 0
      ? discovered.map(buildLocalOption)
      : LLM_MODELS.filter((m) => m.provider === "local");
    return {
      localOptions: local,
      cloudOptions: cloud,
      displayModels: [...local, ...cloud],
    };
  }, [healthCheck.data]);

  const selectedModel: LLMModelConfig =
    displayModels.find((m) => m.id === selectedModelId) ??
    LLM_MODELS.find((m) => m.id === selectedModelId) ??
    (selectedModelId && selectedModelId.length > 0
      ? buildLocalOption(selectedModelId)
      : LLM_MODELS.find((m) => m.isDefault) ?? LLM_MODELS[0]);
  const Icon = PROVIDER_ICONS[selectedModel.provider] || Sparkles;
  const colors = PROVIDER_COLORS[selectedModel.provider] || PROVIDER_COLORS.openai;

  // Compute dropdown position relative to viewport (fixed positioning)
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportPadding = 16;
    const gap = 4;
    const dropdownWidth = 280;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const estimatedDropdownHeight = Math.min(
      displayModels.length * 76 + 80,
      Math.floor(viewportHeight * 0.75)
    );
    const spaceBelow = viewportHeight - rect.bottom - viewportPadding - gap;
    const spaceAbove = rect.top - viewportPadding - gap;
    const openUpward = spaceBelow < 260 && spaceAbove > spaceBelow;
    const availableSpace = Math.max(openUpward ? spaceAbove : spaceBelow, 120);

    const maxHeight = Math.min(
      Math.max(Math.min(220, viewportHeight - viewportPadding * 2), Math.min(estimatedDropdownHeight, availableSpace)),
      viewportHeight - viewportPadding * 2
    );

    const rawTop = openUpward ? rect.top - maxHeight - gap : rect.bottom + gap;
    const top = Math.max(viewportPadding, Math.min(rawTop, viewportHeight - viewportPadding - maxHeight));
    const left = Math.max(
      viewportPadding,
      Math.min(rect.left, viewportWidth - viewportPadding - dropdownWidth)
    );

    setDropdownPos({ top, left });
    setDropdownMaxHeight(maxHeight);
  }, [displayModels.length]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  // Recalculate position on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen, updatePosition]);

  const handleSelect = (model: LLMModelConfig) => {
    setSelectedModelId(model.id as ModelId);
    setIsOpen(false);
  };

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen) updatePosition();
    setIsOpen(!isOpen);
  };

  const renderModelButton = (model: LLMModelConfig) => {
    const ModelIcon = PROVIDER_ICONS[model.provider] || Sparkles;
    const modelColors = PROVIDER_COLORS[model.provider] || PROVIDER_COLORS.openai;
    const isSelected = model.id === selectedModelId;

    return (
      <button
        key={model.id}
        onClick={() => handleSelect(model)}
        className={cn(
          "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-2xl transition-colors text-left mb-0.5",
          isSelected
            ? cn(modelColors.bg, "ring-1 ring-inset", modelColors.border)
            : "hover:bg-slate-50 dark:hover:bg-slate-700/50"
        )}
      >
        <div
          className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
            modelColors.bg
          )}
        >
          <ModelIcon className={cn("w-3.5 h-3.5", modelColors.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-[13px] font-medium leading-tight",
                isSelected
                  ? modelColors.text
                  : "text-slate-700 dark:text-slate-200"
              )}
            >
              {model.name}
            </span>
            {model.isDefault && (
              <span className="px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 rounded-full">
                Default
              </span>
            )}
            {isSelected && (
              <Check className={cn("w-3.5 h-3.5 ml-auto flex-shrink-0", modelColors.text)} />
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5 truncate">
            {model.description} · {(model.contextWindow / 1000).toFixed(0)}K
          </p>
        </div>
      </button>
    );
  };

  const sectionHeaderClass =
    "text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider";

  // Render the dropdown via portal so it escapes any overflow:hidden ancestors
  const dropdown = isOpen && dropdownPos
    ? createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-[280px] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-[9999] flex flex-col overflow-hidden"
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            maxHeight: dropdownMaxHeight
              ? `${dropdownMaxHeight}px`
              : `min(70vh, ${window.innerHeight - 32}px)`,
          }}
        >
          {/* Header */}
          <div className="px-3 pt-2.5 pb-1.5 flex-shrink-0">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Select Model
            </span>
          </div>

          {/* Scrollable model list */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-2"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {localOptions.length > 0 && (
              <>
                <div className="px-2 pt-1 pb-0.5">
                  <span className={sectionHeaderClass}>Local Models</span>
                </div>
                {localOptions.map(renderModelButton)}
              </>
            )}
            {cloudOptions.length > 0 && (
              <>
                <div className={cn("px-2 pb-0.5", localOptions.length > 0 ? "pt-2" : "pt-1")}>
                  <span className={sectionHeaderClass}>Cloud Models</span>
                </div>
                {cloudOptions.map(renderModelButton)}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
              Persists across sessions. Auto-fallback if unavailable (except Local).
            </p>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300",
          "border border-slate-200/50 dark:border-slate-700/50 bg-white dark:bg-slate-800/80 shadow-sm",
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "hover:bg-slate-50 dark:hover:bg-slate-700/80 cursor-pointer",
          isOpen && "ring-2 ring-teal-500/40 border-teal-400/50 shadow-md"
        )}
      >
        <Icon className={cn("w-3.5 h-3.5", colors.text)} />
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
          {selectedModel.name}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-slate-400 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {dropdown}
    </div>
  );
}
