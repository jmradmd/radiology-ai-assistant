import { create } from 'zustand';
import { APP_BASE_URL } from '../lib/constants';

// Global window interface for Electron IPC
declare global {
  interface Window {
    electron: {
      hideWindow: () => void;
      openExternal: (url: string) => void;
      store: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<boolean>;
        delete: (key: string) => Promise<boolean>;
      };
    };
  }
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  isDemo: boolean;
  user: User | null;
  token: string | null;
  checkAuth: () => Promise<void>;
  login: (token: string) => Promise<boolean>;
  loginDemo: () => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

// Demo token for development - works with the backend demo auth
const DEMO_TOKEN = 'demo-token';

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  isDemo: false,
  user: null,
  token: null,

  getToken: async () => {
    const state = get();
    if (state.token) return state.token;
    try {
      const stored = await window.electron.store.get('authToken');
      return (stored as string) || null;
    } catch {
      return null;
    }
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const storedToken = await window.electron.store.get('authToken');
      const token = storedToken as string | null;
      if (!token) {
        set({ isAuthenticated: false, user: null, token: null, isLoading: false });
        return;
      }

      // Validate token with server
      const response = await fetch(`${APP_BASE_URL}/api/trpc/user.me`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        await window.electron.store.set('authToken', null);
        set({ isAuthenticated: false, user: null, token: null, isLoading: false });
        return;
      }

      const data = await response.json();
      const user = data.result?.data;

      if (user) {
        set({ isAuthenticated: true, user, token, isLoading: false });
      } else {
        await window.electron.store.set('authToken', null);
        set({ isAuthenticated: false, user: null, token: null, isLoading: false });
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      set({ isAuthenticated: false, user: null, token: null, isLoading: false });
    }
  },

  login: async (token: string) => {
    try {
      // Validate token
      const response = await fetch(`${APP_BASE_URL}/api/trpc/user.me`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const user = data.result?.data;

      if (user) {
        await window.electron.store.set('authToken', token);
        set({ isAuthenticated: true, user, token });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  loginDemo: async () => {
    // Demo mode - use demo token which the backend recognizes
    const demoUser: User = {
      id: 'demo-user',
      email: 'demo@example.com',
      name: 'Demo User',
      role: 'COORDINATOR',
    };
    
    await window.electron.store.set('authToken', DEMO_TOKEN);
    set({ isAuthenticated: true, isDemo: true, user: demoUser, token: DEMO_TOKEN });
  },

  logout: async () => {
    await window.electron.store.delete('authToken');
    set({ isAuthenticated: false, isDemo: false, user: null, token: null });
  },
}));
