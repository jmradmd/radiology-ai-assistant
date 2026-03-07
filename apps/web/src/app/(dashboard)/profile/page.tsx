"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  Building2,
  LogOut,
  Settings,
  Bell,
  Shield,
  HelpCircle,
  ChevronRight,
  Stethoscope,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { getInitials } from "@/lib/utils";
import { ROLE_DISPLAY_NAMES, SUBSPECIALTY_DISPLAY_NAMES } from "@rad-assist/shared";
import { trpc } from "@/lib/trpc/client";
import type { Subspecialty } from "@rad-assist/shared";

const SUBSPECIALTIES: Subspecialty[] = [
  "ABDOMINAL",
  "NEURO",
  "MSK",
  "CHEST",
  "IR",
  "PEDS",
  "BREAST",
  "NUCLEAR",
  "CARDIAC",
];

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout, setUser } = useAuthStore();
  const utils = trpc.useUtils();

  const updateProfile = trpc.user.updateProfile.useMutation({
    onSuccess: (updatedUser) => {
      setUser(updatedUser);
      utils.user.me.invalidate();
    },
  });

  const handleSubspecialtyChange = (value: string) => {
    const subspecialty = value === "none" ? null : (value as Subspecialty);
    updateProfile.mutate({ subspecialty });
  };

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  const menuItems = [
    {
      icon: Bell,
      label: "Notification Settings",
      href: "/settings/notifications",
    },
    {
      icon: Shield,
      label: "Privacy & Security",
      href: "/settings/privacy",
    },
    {
      icon: Settings,
      label: "App Settings",
      href: "/settings",
    },
    {
      icon: HelpCircle,
      label: "Help & Support",
      href: "/help",
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)]">
      {/* Header */}
      <header className="flex-shrink-0 header-blur p-4">
        <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Profile Card */}
          <Card className="border-slate-200/80 dark:border-slate-700/60 overflow-hidden shadow-sm shadow-slate-200/50 dark:shadow-none">
            <div className="h-24 bg-gradient-to-r from-brand-500 to-teal-400 dark:from-brand-900 dark:to-teal-800" />
            <CardContent className="p-6 -mt-12">
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-20 w-20 mb-4 ring-4 ring-white dark:ring-slate-800 shadow-md">
                  <AvatarImage src={user?.avatarUrl ?? undefined} />
                  <AvatarFallback className="bg-brand-100 text-brand-700 text-xl font-semibold">
                    {getInitials(user?.name ?? "U")}
                  </AvatarFallback>
                </Avatar>
                <h2 className="text-xl font-semibold tracking-tight">{user?.name}</h2>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="secondary">
                    {ROLE_DISPLAY_NAMES[user?.role ?? "STAFF"]}
                  </Badge>
                  {user?.subspecialty && (
                    <Badge variant="outline">
                      {SUBSPECIALTY_DISPLAY_NAMES[user.subspecialty]}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section/Subspecialty */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Section / Subspecialty</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <Stethoscope className="h-4 w-4 text-muted-foreground" />
                </div>
                <Select
                  value={user?.subspecialty ?? "none"}
                  onValueChange={handleSubspecialtyChange}
                  disabled={updateProfile.isPending}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select your section" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No section selected</SelectItem>
                    {SUBSPECIALTIES.map((sub) => (
                      <SelectItem key={sub} value={sub}>
                        {SUBSPECIALTY_DISPLAY_NAMES[sub]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Contact Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="text-sm font-medium">{user?.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Department</p>
                  <p className="text-sm font-medium">
                    {user?.department ?? "Radiology"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Settings Menu */}
          <Card className="border-slate-200/80 dark:border-slate-700/60">
            <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  className="flex items-center justify-between w-full p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left group"
                  onClick={() => router.push(item.href)}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-brand-100 dark:group-hover:bg-brand-900/40 group-hover:scale-105 transition-all duration-200 shadow-sm">
                      <item.icon className="h-[18px] w-[18px] text-muted-foreground group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors" />
                    </div>
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Logout */}
          <Button
            variant="outline"
            className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30 border-slate-200/80 dark:border-slate-700/60"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>

          {/* Version */}
          <p className="text-[11px] text-center text-muted-foreground pb-2">
            v0.1.0
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
