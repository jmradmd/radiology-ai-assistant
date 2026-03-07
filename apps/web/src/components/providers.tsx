"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import superjson from "superjson";
import { Toaster } from "@/components/ui/toaster";
import { useAuthStore } from "@/stores/auth";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const setUser = useAuthStore((state) => state.setUser);
  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const logout = useAuthStore((state) => state.logout);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          headers() {
            const state = useAuthStore.getState();
            const accessToken = state.accessToken;
            
            // Debug: Log auth state on each request (dev only)
            if (process.env.NODE_ENV === 'development') {
              console.log('[tRPC] Request headers - Auth state:', { 
                isAuthenticated: state.isAuthenticated,
                isHydrated: state.isHydrated,
                hasToken: !!accessToken,
                tokenType: accessToken === 'demo-token' ? 'DEMO' : accessToken ? 'JWT' : 'NONE',
              });
            }
            
            // Always include Authorization header if we have a token
            if (accessToken) {
              return { Authorization: `Bearer ${accessToken}` };
            }
            
            // Warn in development if making request without token
            if (process.env.NODE_ENV === 'development' && state.isHydrated) {
              console.warn('[tRPC] Making request without auth token!');
            }
            
            return {};
          },
        }),
      ],
    })
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let isMounted = true;

    const applySessionToken = (token: string | null | undefined) => {
      if (!isMounted || !token) return;
      const state = useAuthStore.getState();
      if (state.accessToken === token) return;

      if (state.user) {
        setUser(state.user, token);
      } else {
        setAccessToken(token);
      }
    };

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("[Auth] Failed to read current session", error.message);
          return;
        }
        applySessionToken(data.session?.access_token);
      })
      .catch((error) => {
        console.error("[Auth] Session bootstrap error", error);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      if (event === "SIGNED_OUT") {
        logout();
        return;
      }

      applySessionToken(session?.access_token);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [logout, setAccessToken, setUser]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
