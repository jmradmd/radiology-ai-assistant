import { create } from "zustand";
import { persist, createJSONStorage, StateStorage } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  department?: string | null;
  subspecialty?: string | null;
  avatarUrl?: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean; // Track if store has loaded from storage
  rememberMe: boolean;
  setUser: (user: User | null, token?: string | null, remember?: boolean) => void;
  setAccessToken: (token: string | null) => void;
  logout: () => void;
  setHydrated: (hydrated: boolean) => void;
  setRememberMe: (remember: boolean) => void;
}

// Custom storage that checks rememberMe preference
const createAuthStorage = (): StateStorage => ({
  getItem: (name: string) => {
    if (typeof window === "undefined") return null;
    // Try localStorage first, then sessionStorage
    return localStorage.getItem(name) || sessionStorage.getItem(name);
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") return;
    // Parse to check rememberMe flag
    try {
      const parsed = JSON.parse(value);
      const rememberMe = parsed?.state?.rememberMe ?? true;
      if (rememberMe) {
        localStorage.setItem(name, value);
        sessionStorage.removeItem(name);
      } else {
        sessionStorage.setItem(name, value);
        localStorage.removeItem(name);
      }
    } catch {
      localStorage.setItem(name, value);
    }
  },
  removeItem: (name: string) => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
  },
});

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isHydrated: false, // Start false, set true after hydration
      rememberMe: true,
      setUser: (user, token, remember) =>
        set((state) => ({
          user,
          // Preserve existing token if not explicitly provided (undefined)
          // Only clear if explicitly passed as null
          accessToken: token !== undefined ? token : state.accessToken,
          isAuthenticated: !!user,
          rememberMe: remember ?? state.rememberMe,
        })),
      setAccessToken: (token) => set({ accessToken: token }),
      logout: () => {
        // Clear both storages on logout
        if (typeof window !== "undefined") {
          localStorage.removeItem("rad-assist-auth");
          sessionStorage.removeItem("rad-assist-auth");
        }
        return set({
          user: null,
          accessToken: null,
          isAuthenticated: false,
          rememberMe: true,
        });
      },
      setHydrated: (hydrated) => set({ isHydrated: hydrated }),
      setRememberMe: (remember) => set({ rememberMe: remember }),
    }),
    {
      name: "rad-assist-auth",
      storage: createJSONStorage(() => createAuthStorage()),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
        rememberMe: state.rememberMe,
      }),
      onRehydrateStorage: () => (state) => {
        // Called when hydration completes
        state?.setHydrated(true);
      },
    }
  )
);
