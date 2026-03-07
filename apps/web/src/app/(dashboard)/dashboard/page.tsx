"use client";

import { useAuthStore } from "@/stores/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  ChevronRight,
  Bot,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { getInitials, formatRelativeTime } from "@/lib/utils";
import { SUBSPECIALTY_DISPLAY_NAMES } from "@rad-assist/shared";
import { trpc } from "@/lib/trpc/client";

export default function DashboardPage() {
  const { user } = useAuthStore();
  const greeting = getGreeting();

  // Real data queries
  const { data: requestCounts, isLoading: countsLoading } = trpc.request.counts.useQuery();
  const { data: onCallData, isLoading: onCallLoading } = trpc.schedule.getCurrentOnCall.useQuery({});
  const { data: recentRequestsData, isLoading: requestsLoading } = trpc.request.list.useQuery({ 
    limit: 5 
  });

  // Fallback to zeros while loading
  const stats = {
    pending: requestCounts?.pending ?? 0,
    stat: requestCounts?.stat ?? 0,
    urgent: requestCounts?.urgent ?? 0,
    resolved: requestCounts?.resolved ?? 0,
  };

  const onCallProviders = onCallData ?? [];
  const recentRequests = recentRequestsData?.requests ?? [];

  return (
    <div className="flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 header-blur border-b border-slate-200/80 dark:border-slate-800/80 shadow-sm shadow-slate-200/20 dark:shadow-slate-900/20">
        <div className="flex h-16 items-center justify-between px-4">
          <div>
            <p className="text-sm text-muted-foreground">{greeting}</p>
            <h1 className="text-xl font-semibold tracking-tight">{user?.name}</h1>
          </div>
          <Avatar className="h-10 w-10 ring-2 ring-brand-100 dark:ring-brand-900/40">
            <AvatarImage src={user?.avatarUrl ?? undefined} />
            <AvatarFallback className="bg-brand-100 text-brand-700 font-medium">
              {getInitials(user?.name ?? "U")}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Quick Actions */}
          <section className="grid grid-cols-2 gap-3">
            <Link href="/chat">
              <Card className="card-hover cursor-pointer group border-slate-200/80 dark:border-slate-700/60">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center group-hover:bg-brand-100 dark:group-hover:bg-brand-900/50 transition-colors">
                    <Bot className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Protocol Assistant</p>
                    <p className="text-xs text-muted-foreground">Ask questions</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/messages">
              <Card className="card-hover cursor-pointer group border-slate-200/80 dark:border-slate-700/60">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center relative group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50 transition-colors">
                    <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Messages</p>
                    <p className="text-xs text-muted-foreground">Direct messages</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </section>

          {/* Stats Overview */}
          <section>
            <h2 className="text-lg font-semibold mb-3 tracking-tight">Request Queue</h2>
            {countsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                <Link href="/queue?filter=stat" className="block">
                  <Card className="h-full border-red-200/80 dark:border-red-800/40 bg-red-50 dark:bg-red-950/30 hover:bg-red-100/80 dark:hover:bg-red-900/40 transition-colors">
                    <CardContent className="p-3 text-center">
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400 tabular-nums">
                        {stats.stat}
                      </p>
                      <p className="text-[11px] text-red-600/80 dark:text-red-400/80 font-semibold tracking-wide uppercase">STAT</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/queue?filter=urgent" className="block">
                  <Card className="h-full border-amber-200/80 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/80 dark:hover:bg-amber-900/40 transition-colors">
                    <CardContent className="p-3 text-center">
                      <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                        {stats.urgent}
                      </p>
                      <p className="text-[11px] text-amber-600/80 dark:text-amber-400/80 font-semibold tracking-wide uppercase">Urgent</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/queue?filter=pending" className="block">
                  <Card className="h-full border-blue-200/80 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100/80 dark:hover:bg-blue-900/40 transition-colors">
                    <CardContent className="p-3 text-center">
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                        {stats.pending}
                      </p>
                      <p className="text-[11px] text-blue-600/80 dark:text-blue-400/80 font-semibold tracking-wide uppercase">Pending</p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/queue?filter=all" className="block">
                  <Card className="h-full border-green-200/80 dark:border-green-800/40 bg-green-50/50 dark:bg-green-950/20 hover:bg-green-100/80 dark:hover:bg-green-900/40 transition-colors">
                    <CardContent className="p-3 text-center">
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400 tabular-nums">
                        {stats.resolved}
                      </p>
                      <p className="text-[11px] text-green-600/80 dark:text-green-400/80 font-semibold tracking-wide uppercase">Resolved</p>
                    </CardContent>
                  </Card>
                </Link>
              </div>
            )}
          </section>

          {/* On-Call Today */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold tracking-tight">On-Call Now</h2>
              <Link href="/schedule">
                <Button variant="ghost" size="sm" className="text-brand-600">
                  View All
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
            {onCallLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : onCallProviders.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-center text-muted-foreground">
                  No on-call schedule configured for today
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0 divide-y">
                  {onCallProviders.slice(0, 5).map((provider: any) => (
                    <div
                      key={provider.id}
                      className="flex items-center justify-between p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-2 rounded-full bg-green-500" />
                        <div>
                          <p className="font-medium text-sm">
                            {SUBSPECIALTY_DISPLAY_NAMES[provider.subspecialty] ?? provider.subspecialty}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {provider.name}
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {provider.role}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>

          {/* Recent Requests */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold tracking-tight">Recent Requests</h2>
              <Link href="/queue">
                <Button variant="ghost" size="sm" className="text-brand-600">
                  View All
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
            {requestsLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : recentRequests.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-center text-muted-foreground">
                  No recent requests
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {recentRequests.map((request: any) => (
                  <Link key={request.id} href={`/queue/${request.id}`}>
                    <Card className="card-hover cursor-pointer border-slate-200/80 dark:border-slate-700/60">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge
                                variant={
                                  request.priority === "STAT"
                                    ? "stat"
                                    : request.priority === "URGENT"
                                    ? "urgent"
                                    : "routine"
                                }
                                className="text-xs"
                              >
                                {request.priority}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {request.status.replace("_", " ")}
                              </Badge>
                            </div>
                            <p className="text-sm font-medium truncate">
                              {request.subject}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatRelativeTime(request.createdAt)}
                            </p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
