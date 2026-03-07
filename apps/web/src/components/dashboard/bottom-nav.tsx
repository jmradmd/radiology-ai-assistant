"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  ClipboardList,
  Calendar,
  BookOpen,
  User,
} from "lucide-react";

const navItems = [
  {
    href: "/chat",
    label: "Chat",
    icon: MessageSquare,
    matchPaths: ["/", "/chat"], // Chat is the home page
  },
  {
    href: "/queue",
    label: "Queue",
    icon: ClipboardList,
  },
  {
    href: "/schedule",
    label: "Schedule",
    icon: Calendar,
  },
  {
    href: "/reference",
    label: "Directory",
    icon: BookOpen,
  },
  {
    href: "/profile",
    label: "Profile",
    icon: User,
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800/80 pb-[max(env(safe-area-inset-bottom),0px)]">
      <div className="flex items-center justify-around max-w-md mx-auto h-14">
        {navItems.map((item) => {
          const isActive = item.matchPaths
            ? item.matchPaths.includes(pathname)
            : pathname === item.href || pathname?.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 w-16 h-full transition-colors",
                isActive
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              )}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-[2.5px] rounded-full bg-brand-500 dark:bg-brand-400" />
              )}
              <Icon className={cn("w-[19px] h-[19px]", isActive && "stroke-[2.5px]")} />
              <span className={cn("text-[10px]", isActive ? "font-semibold" : "font-medium")}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
