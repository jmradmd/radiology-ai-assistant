import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Cpu, Check } from 'lucide-react';
import { usePreferencesStore } from '../stores/preferences';
import { AVAILABLE_MODELS } from '../lib/constants';
import { cn } from '../lib/utils';

export function ModelSelect() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { selectedModelId, setSelectedModelId } = usePreferencesStore();
  const currentModel =
    AVAILABLE_MODELS.find((m) => m.id === selectedModelId) || AVAILABLE_MODELS[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={ref}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
      >
        <Cpu className="w-3.5 h-3.5" />
        <span className="max-w-[80px] truncate">{currentModel.name}</span>
        <ChevronDown
          className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden z-50 animate-fade-in">
          {AVAILABLE_MODELS.map((model) => {
            const isSelected = model.id === selectedModelId;

            return (
              <button
                key={model.id}
                onClick={() => {
                  setSelectedModelId(model.id);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors',
                  isSelected && 'bg-gray-50 dark:bg-slate-700'
                )}
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{model.name}</p>
                  <p className="text-xs text-gray-500">{model.description}</p>
                </div>
                {isSelected && <Check className="w-4 h-4 text-teal-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
