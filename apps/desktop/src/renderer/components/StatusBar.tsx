import React, { useState } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { InstitutionSelect } from './InstitutionSelect';
import { ModelSelect } from './ModelSelect';
import { SettingsMenu } from './SettingsMenu';

interface StatusBarProps {
  onNewChat: () => void;
}

export function StatusBar({ onNewChat }: StatusBarProps) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="h-11 px-3 flex items-center justify-between border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50">
      {/* Left side: filters */}
      <div className="flex items-center gap-2">
        <InstitutionSelect />
        <div className="w-px h-5 bg-gray-200 dark:bg-slate-700" />
        <ModelSelect />
      </div>

      {/* Right side: actions */}
      <div className="flex items-center gap-1">
        {/* New chat button */}
        <button
          onClick={onNewChat}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
          title="New conversation"
        >
          <RotateCcw className="w-4 h-4 text-gray-500" />
        </button>

        {/* Settings button */}
        <div className="relative">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
            title="Settings"
          >
            <SlidersHorizontal className="w-4 h-4 text-gray-500" />
          </button>

          {/* Settings menu */}
          {showSettings && <SettingsMenu onClose={() => setShowSettings(false)} />}
        </div>
      </div>
    </div>
  );
}
