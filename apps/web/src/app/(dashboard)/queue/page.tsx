"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Search,
  Clock,
  ChevronRight,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { cn, formatRelativeTime } from "@/lib/utils";
import { SUBSPECIALTY_DISPLAY_NAMES, PRIORITY_RESPONSE_TIMES } from "@rad-assist/shared";
import { trpc } from "@/lib/trpc/client";

export default function QueuePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Real data query
  const { data, isLoading } = trpc.request.list.useQuery({
    limit: 50,
  });

  const allRequests = data?.requests ?? [];

  // Client-side filtering based on tab and search
  const filteredRequests = allRequests.filter((request: any) => {
    const matchesSearch =
      request.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      request.requestedBy?.name?.toLowerCase().includes(searchQuery.toLowerCase());

    if (activeTab === "all") return matchesSearch;
    if (activeTab === "stat") return matchesSearch && request.priority === "STAT";
    if (activeTab === "urgent") return matchesSearch && request.priority === "URGENT";
    if (activeTab === "pending") return matchesSearch && request.status === "PENDING";

    return matchesSearch;
  });

  const statCount = allRequests.filter((r: any) => r.priority === "STAT").length;
  const urgentCount = allRequests.filter((r: any) => r.priority === "URGENT").length;
  const pendingCount = allRequests.filter((r: any) => r.status === "PENDING").length;

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)]">
      {/* Header */}
      <header className="flex-shrink-0 header-blur border-b border-slate-200/80 dark:border-slate-800/80 shadow-sm shadow-slate-200/20 dark:shadow-slate-900/20 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Request Queue</h1>
          <Link href="/queue/new">
            <Button size="sm" className="shadow-sm shadow-primary/20">
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </Link>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search requests..."
            className="pl-9 bg-slate-50/50 dark:bg-slate-800/50"
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">
              All
            </TabsTrigger>
            <TabsTrigger value="stat" className="flex-1">
              STAT
              {statCount > 0 && (
                <Badge variant="stat" className="ml-1 h-5 w-5 p-0 justify-center">
                  {statCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="urgent" className="flex-1">
              Urgent
              {urgentCount > 0 && (
                <Badge variant="urgent" className="ml-1 h-5 w-5 p-0 justify-center">
                  {urgentCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="pending" className="flex-1">
              Pending
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {/* Request List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Loading requests...</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-14 w-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {searchQuery ? "No requests match your search" : "No requests found"}
              </p>
            </div>
          ) : (
            filteredRequests.map((request: any) => (
              <RequestCard key={request.id} request={request} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function RequestCard({ request }: { request: any }) {
  const timeSinceCreated = Date.now() - new Date(request.createdAt).getTime();
  const responseTime = PRIORITY_RESPONSE_TIMES[request.priority as keyof typeof PRIORITY_RESPONSE_TIMES] * 60 * 1000;
  const isOverdue = timeSinceCreated > responseTime && request.status === "PENDING";

  return (
    <Link href={`/queue/${request.id}`}>
      <Card
        className={cn(
          "card-hover cursor-pointer border-slate-200/80 dark:border-slate-700/60",
          request.priority === "STAT" && "border-l-4 border-l-red-500 dark:border-l-red-400",
          request.priority === "URGENT" && "border-l-4 border-l-amber-500 dark:border-l-amber-400"
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0 space-y-2">
              {/* Priority and Status */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={
                    request.priority === "STAT"
                      ? "stat"
                      : request.priority === "URGENT"
                      ? "urgent"
                      : "routine"
                  }
                >
                  {request.priority}
                </Badge>
                <Badge variant="outline">
                  {request.status.replace("_", " ")}
                </Badge>
                {request.subspecialty && (
                  <Badge variant="secondary">
                    {SUBSPECIALTY_DISPLAY_NAMES[request.subspecialty] ?? request.subspecialty}
                  </Badge>
                )}
              </div>

              {/* Subject */}
              <p className="font-medium text-sm line-clamp-2">
                {request.subject}
              </p>

              {/* Meta info */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>From: {request.requestedBy?.name ?? "Unknown"}</span>
                {request.location && (
                  <>
                    <span>•</span>
                    <span>{request.location}</span>
                  </>
                )}
              </div>

              {/* Time */}
              <div className="flex items-center gap-2">
                <Clock
                  className={cn(
                    "h-3 w-3",
                    isOverdue ? "text-red-500" : "text-muted-foreground"
                  )}
                />
                <span
                  className={cn(
                    "text-xs",
                    isOverdue ? "text-red-500 font-medium" : "text-muted-foreground"
                  )}
                >
                  {formatRelativeTime(request.createdAt)}
                  {isOverdue && " - OVERDUE"}
                </span>
              </div>

              {/* Assigned to */}
              {request.assignedTo && (
                <p className="text-xs text-muted-foreground">
                  Assigned to: {request.assignedTo.name}
                </p>
              )}
            </div>

            <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
