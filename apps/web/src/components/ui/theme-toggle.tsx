"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  // Only run on client to avoid hydration mismatch
  // Read the ACTUAL current theme from DOM (set by blocking script in layout)
  // Don't re-apply - just sync React state with what's already there
  useEffect(() => {
    setMounted(true);
    // Read current theme from DOM (blocking script already applied it)
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
    
    // Ensure localStorage is synced (in case it was set by system preference)
    const stored = localStorage.getItem("rad-assist-theme");
    if (!stored) {
      // Save current state to localStorage so it persists
      localStorage.setItem("rad-assist-theme", isDark ? "dark" : "light");
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("rad-assist-theme", newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
  };

  // Avoid hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <button
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center",
          "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400",
          className
        )}
        disabled
      >
        <Sun className="w-4 h-4" />
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
        "bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800",
        "dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 dark:hover:text-slate-100",
        className
      )}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? (
        <Moon className="w-4 h-4" />
      ) : (
        <Sun className="w-4 h-4" />
      )}
    </button>
  );
}
