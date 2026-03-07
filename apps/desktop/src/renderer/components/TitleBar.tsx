import React from 'react';
import { X, Minus } from 'lucide-react';

interface TitleBarProps {
  onClose: () => void;
}

export function TitleBar({ onClose }: TitleBarProps) {
  return (
    <div
      className="h-9 flex items-center justify-between px-3 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Logo and title */}
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
          <span className="text-white text-xs font-bold">P</span>
        </div>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Radiology AI Assistant</span>
      </div>

      {/* Window controls */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          title="Minimize"
        >
          <Minus className="w-4 h-4 text-gray-500" />
        </button>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/30 group transition-colors"
          title="Close"
        >
          <X className="w-4 h-4 text-gray-500 group-hover:text-red-600" />
        </button>
      </div>
    </div>
  );
}
