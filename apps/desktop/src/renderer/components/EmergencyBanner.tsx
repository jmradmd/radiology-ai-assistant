import React from 'react';
import { AlertTriangle, Phone, X } from 'lucide-react';

interface EmergencyBannerProps {
  assessment: {
    severity: string;
    triggers: string[];
  };
  onDismiss: () => void;
}

export function EmergencyBanner({ assessment, onDismiss }: EmergencyBannerProps) {
  return (
    <div className="bg-amber-100 border-b border-amber-200 px-3 py-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-amber-800">
            {assessment.severity === 'emergency' ? 'EMERGENCY' : 'URGENT'}
          </span>
          <div className="flex flex-wrap gap-1 my-2">
            {assessment.triggers.slice(0, 4).map((trigger, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded text-xs bg-amber-200 text-amber-800">
                {trigger}
              </span>
            ))}
          </div>
          <button
            onClick={() => window.electron.openExternal('tel:911')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
          >
            <Phone className="w-3.5 h-3.5" />
            Call Emergency (911)
          </button>
        </div>
        <button onClick={onDismiss} className="p-1 rounded hover:bg-amber-200">
          <X className="w-4 h-4 text-amber-600" />
        </button>
      </div>
    </div>
  );
}
