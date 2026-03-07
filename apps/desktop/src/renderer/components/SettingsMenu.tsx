import React, { useRef, useEffect } from 'react';
import { usePreferencesStore } from '../stores/preferences';
import { useAuthStore } from '../stores/auth';
import { OUTPUT_STYLES, APP_BASE_URL } from '../lib/constants';
import { cn } from '../lib/utils';
import { LogOut, ExternalLink, Check } from 'lucide-react';

interface SettingsMenuProps {
  onClose: () => void;
}

export function SettingsMenu({ onClose }: SettingsMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { outputStyle, autoExpandSources, setOutputStyle, setAutoExpandSources } =
    usePreferencesStore();
  const { logout } = useAuthStore();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full right-0 mb-1 w-64 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 overflow-hidden z-50 animate-fade-in"
    >
      {/* Response style section */}
      <div className="p-3 border-b border-gray-100 dark:border-slate-700">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
          Response Style
        </p>
        <div className="space-y-1">
          {OUTPUT_STYLES.map((style) => (
            <button
              key={style.id}
              onClick={() => setOutputStyle(style.id as 'auto' | 'concise' | 'detailed')}
              className={cn(
                'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors',
                outputStyle === style.id && 'bg-gray-50 dark:bg-slate-700'
              )}
            >
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{style.name}</p>
                <p className="text-xs text-gray-500">{style.description}</p>
              </div>
              {outputStyle === style.id && <Check className="w-4 h-4 text-teal-600" />}
            </button>
          ))}
        </div>
      </div>

      {/* Display options section */}
      <div className="p-3 border-b border-gray-100 dark:border-slate-700">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Auto-expand sources
          </span>
          <input
            type="checkbox"
            checked={autoExpandSources}
            onChange={(e) => setAutoExpandSources(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
          />
        </label>
      </div>

      {/* Actions section */}
      <div className="p-2">
        <button
          onClick={() => {
            window.electron.openExternal(APP_BASE_URL);
            onClose();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Open in Browser
        </button>
        <button
          onClick={() => {
            logout();
            onClose();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
