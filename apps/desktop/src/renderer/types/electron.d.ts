interface ElectronAPI {
  // Window control
  hideWindow: () => void;
  closeWindow: () => void;
  showWindow: () => void;

  // Auth persistence (encrypted in OS keychain)
  getAuthToken: () => Promise<string | null>;
  setAuthToken: (token: string) => Promise<boolean>;
  clearAuthToken: () => Promise<boolean>;
  canEncrypt: () => Promise<boolean>;

  // Preferences
  getPreferences: () => Promise<{
    selectedInstitution: 'INSTITUTION_A' | 'INSTITUTION_B' | null;
    selectedModelId: string;
    outputStyle: 'concise' | 'detailed' | 'auto';
    autoExpandSources: boolean;
    showConfidenceScores: boolean;
  }>;
  setPreferences: (prefs: Partial<{
    selectedInstitution: 'INSTITUTION_A' | 'INSTITUTION_B' | null;
    selectedModelId: string;
    outputStyle: 'concise' | 'detailed' | 'auto';
    autoExpandSources: boolean;
    showConfidenceScores: boolean;
  }>) => Promise<boolean>;

  // App info
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;

  // Shell operations
  openExternal: (url: string) => void;

  // Notifications
  showNotification: (title: string, body: string, urgency?: 'normal' | 'critical') => void;

  // Tray
  setTrayIcon: (name: 'default' | 'alert') => void;

  // Clipboard
  copyToClipboard: (text: string) => Promise<boolean>;

  // Events from main process
  onWindowShown: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
