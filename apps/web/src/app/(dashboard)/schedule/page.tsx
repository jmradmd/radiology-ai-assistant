"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  ChevronRight,
  Phone,
  MessageSquare,
  Calendar,
  Loader2,
} from "lucide-react";
import { cn, getInitials } from "@/lib/utils";
import {
  SUBSPECIALTY_DISPLAY_NAMES,
  ROLE_DISPLAY_NAMES,
} from "@rad-assist/shared";
import { trpc } from "@/lib/trpc/client";

export default function SchedulePage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState("today");

  // Get start and end of selected date
  const startOfDay = new Date(selectedDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(selectedDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Real data query
  const { data: scheduleData, isLoading } = trpc.schedule.getSchedule.useQuery({
    startDate: startOfDay.toISOString(),
    endDate: endOfDay.toISOString(),
  });

  const { data: currentOnCall } = trpc.schedule.getCurrentOnCall.useQuery({});

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  const navigateDate = (direction: "prev" | "next") => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + (direction === "next" ? 1 : -1));
    setSelectedDate(newDate);
  };

  // Group schedule data by subspecialty
  const scheduleBySubspecialty: Record<string, any[]> = {};
  if (scheduleData) {
    for (const schedule of scheduleData) {
      for (const assignment of schedule.assignments) {
        const key = assignment.subspecialty;
        if (!scheduleBySubspecialty[key]) {
          scheduleBySubspecialty[key] = [];
        }
        scheduleBySubspecialty[key].push({
          ...assignment,
          shiftType: schedule.shiftType,
          location: schedule.location,
        });
      }
    }
  }

  // Filter by active tab (shift type)
  const filteredSchedule: Record<string, any[]> = {};
  for (const [subspecialty, assignments] of Object.entries(scheduleBySubspecialty)) {
    const filtered = assignments.filter((a: any) => {
      if (activeTab === "today") return a.shiftType === "DAY";
      if (activeTab === "evening") return a.shiftType === "EVENING";
      if (activeTab === "night") return a.shiftType === "NIGHT" || a.shiftType === "CALL";
      return true;
    });
    if (filtered.length > 0) {
      filteredSchedule[subspecialty] = filtered;
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)]">
      {/* Header */}
      <header className="flex-shrink-0 header-blur border-b border-slate-200/80 dark:border-slate-800/80 shadow-sm shadow-slate-200/20 dark:shadow-slate-900/20">
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight">On-Call Schedule</h1>
            <Button variant="outline" size="sm" className="border-slate-200/80 dark:border-slate-700/60">
              <Calendar className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>

          {/* Date Navigation */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => navigateDate("prev")}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="text-center">
              <p className="font-medium tracking-tight">{formatDate(selectedDate)}</p>
              {selectedDate.toDateString() === new Date().toDateString() && (
                <Badge variant="secondary" className="text-xs mt-0.5">
                  Today
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => navigateDate("next")}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="today" className="flex-1">
                Day (7a-5p)
              </TabsTrigger>
              <TabsTrigger value="evening" className="flex-1">
                Evening (5p-10p)
              </TabsTrigger>
              <TabsTrigger value="night" className="flex-1">
                Night (10p-7a)
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* Schedule Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Loading schedule...</p>
            </div>
          ) : Object.keys(filteredSchedule).length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <p>No schedule configured for this date and shift.</p>
                <p className="text-sm mt-2">
                  Contact your coordinator to set up the on-call schedule.
                </p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(filteredSchedule).map(([subspecialty, assignments]) => (
              <div key={subspecialty} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {SUBSPECIALTY_DISPLAY_NAMES[subspecialty] ?? subspecialty}
                </h2>
                {assignments.map((assignment: any, idx: number) => (
                  <ScheduleCard key={`${assignment.id}-${idx}`} assignment={assignment} />
                ))}
              </div>
            ))
          )}

          {/* Show current on-call if no schedule for selected date */}
          {!isLoading && Object.keys(filteredSchedule).length === 0 && currentOnCall && currentOnCall.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3">Currently On-Call</h2>
              <div className="space-y-2">
                {currentOnCall.map((provider: any) => (
                  <Card key={provider.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-brand-100 text-brand-700">
                            {getInitials(provider.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">{provider.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {SUBSPECIALTY_DISPLAY_NAMES[provider.subspecialty] ?? provider.subspecialty}
                          </p>
                        </div>
                        <Badge variant="available" className="text-xs">
                          On-Call
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ScheduleCard({ assignment }: { assignment: any }) {
  return (
    <Card className="border-slate-200/80 dark:border-slate-700/60">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12 ring-2 ring-brand-100/50 dark:ring-brand-900/30">
            <AvatarFallback className="bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 font-medium">
              {getInitials(assignment.user?.name ?? "?")}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium">{assignment.user?.name ?? "Unknown"}</p>
              {assignment.isPrimary && (
                <Badge variant="default" className="text-xs">
                  Primary
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{ROLE_DISPLAY_NAMES[assignment.user?.role] ?? assignment.user?.role}</span>
              {assignment.location && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span>{assignment.location}</span>
                </>
              )}
            </div>
            <Badge
              variant={
                assignment.coverageType === "ON_SITE"
                  ? "available"
                  : assignment.coverageType === "REMOTE"
                  ? "secondary"
                  : "outline"
              }
              className="mt-1.5 text-xs"
            >
              {assignment.coverageType?.replace("_", " ") ?? "On-Site"}
            </Badge>
          </div>
          <div className="flex gap-1.5">
            {assignment.user?.phoneMobile && (
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-slate-200/80 dark:border-slate-700/60">
                <Phone className="h-4 w-4" />
              </Button>
            )}
            <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-slate-200/80 dark:border-slate-700/60">
              <MessageSquare className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
