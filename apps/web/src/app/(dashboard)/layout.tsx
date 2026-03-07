"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { Loader2 } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isHydrated, accessToken, logout } = useAuthStore();
  
  // Track if we've already redirected to prevent loops
  const hasRedirected = useRef(false);
  
  useEffect(() => {
    // Reset redirect flag on pathname change
    hasRedirected.current = false;
  }, [pathname]);
  
  useEffect(() => {
    // Only check auth after hydration completes
    if (!isHydrated) return;

    // Prevent multiple redirects
    if (hasRedirected.current) return;
    
    // Debug: Log auth state changes
    if (process.env.NODE_ENV === 'development') {
      console.log('[DashboardLayout] Auth state:', { isHydrated, isAuthenticated, hasToken: !!accessToken });
    }
    
    // If not authenticated at all, redirect to login
    if (!isAuthenticated) {
      console.log('[DashboardLayout] Not authenticated after hydration - redirecting to login');
      hasRedirected.current = true;
      router.replace("/login");
      return;
    }
    
    // Note: We do NOT redirect if isAuthenticated but no accessToken.
    // This can happen temporarily during state updates.
    // The tRPC middleware will return UNAUTHORIZED if the token is actually missing,
    // and that error will be handled by the component.
    
  }, [isAuthenticated, isHydrated, accessToken, router]);

  // Show loading while store is hydrating from localStorage/sessionStorage
  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))]">{children}</main>
      <BottomNav />
    </div>
  );
}
