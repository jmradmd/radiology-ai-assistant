"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth";
import { Loader2, Building2, AlertCircle } from "lucide-react";
import { AppLogo } from "@/components/ui/app-logo";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc/client";

export default function LoginPage() {
  const router = useRouter();
  const { setUser, rememberMe, setRememberMe } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [keepSignedIn, setKeepSignedIn] = useState(rememberMe);

  const syncUser = trpc.user.syncFromAuth.useMutation();

  // Supabase Email/Password login
  const handleEmailLogin = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }

    setIsLoading(true);
    setError(null);

    // If Supabase isn't configured, use demo mode
    if (!isSupabaseConfigured && process.env.NODE_ENV === 'development') {
      console.warn("Supabase not configured, using demo mode");
      handleDemoLogin();
      return;
    }

    try {
      let result;
      if (mode === "login") {
        result = await supabase.auth.signInWithPassword({ email, password });
      } else {
        result = await supabase.auth.signUp({ email, password });
      }

      if (result.error) {
        throw result.error;
      }

      if (!result.data.user) {
        throw new Error("No user returned from auth");
      }

      // Sync user to our database
      const user = await syncUser.mutateAsync({
        authId: result.data.user.id,
        email: result.data.user.email!,
        name: result.data.user.user_metadata?.name,
      });

      setUser(user, result.data.session?.access_token ?? "", keepSignedIn);
      router.replace("/chat");
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message || "Login failed");
      setIsLoading(false);
    }
  };

  // Demo login for development
  const handleDemoLogin = async () => {
    setIsLoading(true);
    setError(null);
    
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Demo user
    const demoUser = {
      id: "demo-user-id",
      externalId: null,
      email: email || "demo@example.com",
      name: email?.split("@")[0] || "Demo User",
      role: "COORDINATOR" as const,
      department: "Radiology",
      subspecialty: "ABDOMINAL" as const,
      phoneWork: null,
      phoneMobile: null,
      phonePager: null,
      avatarUrl: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    console.log('[Login] Demo login - setting user with demo-token');
    setUser(demoUser, "demo-token", keepSignedIn);
    
    // Verify token was stored
    const storedState = useAuthStore.getState();
    console.log('[Login] After setUser - token stored:', !!storedState.accessToken);
    
    router.replace("/chat");
  };

  // Azure AD SSO login
  const handleSSOLogin = async () => {
    setIsLoading(true);
    setError(null);

    if (!isSupabaseConfigured) {
      // Redirect to custom Azure endpoint if Supabase isn't configured
      window.location.href = "/api/auth/azure";
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          scopes: "openid profile email",
          redirectTo: `${window.location.origin}/api/auth/callback`,
        },
      });

      if (error) {
        if (error.message.includes("not enabled")) {
          // Azure not configured in Supabase, use custom endpoint
          window.location.href = "/api/auth/azure";
          return;
        }
        throw error;
      }
    } catch (err: any) {
      console.error("SSO error:", err);
      setError(err.message || "SSO login failed");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 gradient-mesh bg-background">
      <Card className="w-full max-w-md shadow-xl shadow-slate-200/50 dark:shadow-black/20 border-slate-200/80 dark:border-slate-700/60 animate-slide-up">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-5">
            <AppLogo size={64} variant="teal" />
          </div>
          <CardTitle className="text-2xl tracking-tight">Welcome</CardTitle>
          <CardDescription className="text-sm mt-1">
            Radiology Communication Platform
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Dev mode notice */}
          {!isSupabaseConfigured && (
            <div className="text-xs text-center text-amber-600 bg-amber-50 p-2 rounded-lg">
              Development mode - Supabase not configured
            </div>
          )}

          {/* SSO Login */}
          <Button
            onClick={handleSSOLogin}
            className="w-full h-12 shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 transition-all duration-200"
            size="lg"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Building2 className="mr-2 h-5 w-5" />
            )}
            Sign in with your institution
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                Or continue with email
              </span>
            </div>
          </div>

          {/* Email/Password Login */}
          <form className="space-y-3" onSubmit={handleEmailLogin}>
            <Input
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
            />
            <Input
              type="password"
              placeholder="Password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="keep-signed-in"
                checked={keepSignedIn}
                onCheckedChange={(checked) => setKeepSignedIn(checked)}
                disabled={isLoading}
              />
              <label
                htmlFor="keep-signed-in"
                className="text-sm text-muted-foreground cursor-pointer select-none"
              >
                Keep me signed in
              </label>
            </div>
            <Button
              type="submit"
              variant="outline"
              className="w-full h-12"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {mode === "login" ? "Sign In" : "Sign Up"}
            </Button>
            <div className="flex justify-between text-xs">
              <button
                type="button"
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
                className="text-brand-600 hover:underline"
                disabled={isLoading}
              >
                {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
              </button>
              {process.env.NODE_ENV === 'development' && !isSupabaseConfigured && (
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  className="text-muted-foreground hover:text-foreground"
                  disabled={isLoading}
                >
                  Demo Login
                </button>
              )}
            </div>
          </form>

          <p className="text-[11px] text-center text-muted-foreground mt-6 leading-relaxed">
            By signing in, you agree to comply with institutional policies
            regarding protected health information.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
