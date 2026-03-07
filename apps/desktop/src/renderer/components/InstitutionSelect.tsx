import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Building2, Check } from 'lucide-react';
import { usePreferencesStore } from '../stores/preferences';
import { INSTITUTIONS } from '../lib/constants';
import { cn, getInstitutionInfo } from '../lib/utils';

export function InstitutionSelect() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { selectedInstitution, setSelectedInstitution } = usePreferencesStore();
  const currentInfo = getInstitutionInfo(selectedInstitution);

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
        className={cn(
          'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors',
          currentInfo.color
        )}
      >
        <Building2 className="w-3.5 h-3.5" />
        <span>{currentInfo.shortName}</span>
        <ChevronDown
          className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden z-50 animate-fade-in">
          {INSTITUTIONS.map((inst) => {
            const info = getInstitutionInfo(inst.id);
            const isSelected = inst.id === selectedInstitution;

            return (
              <button
                key={inst.id ?? 'all'}
                onClick={() => {
                  setSelectedInstitution(inst.id as 'INSTITUTION_A' | 'INSTITUTION_B' | null);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors',
                  isSelected && 'bg-gray-50 dark:bg-slate-700'
                )}
              >
                <div>
                  <p className={cn('font-medium', info.color)}>{inst.shortName}</p>
                  <p className="text-xs text-gray-500">{inst.name}</p>
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
