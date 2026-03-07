"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isHydrated } = useAuthStore();

  useEffect(() => {
    if (isHydrated) {
      // Redirect based on auth status
      if (isAuthenticated) {
        router.replace("/chat");
      } else {
        router.replace("/login");
      }
    }
  }, [isAuthenticated, isHydrated, router]);

  // Show loading while determining auth state
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
    </div>
  );
}
