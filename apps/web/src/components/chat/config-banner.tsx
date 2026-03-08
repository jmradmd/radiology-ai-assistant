"use client";

import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

export function ConfigBanner() {
  const healthCheck = trpc.system.healthCheck.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  if (healthCheck.isLoading) return null;

  if (healthCheck.isError) {
    return (
      <div className="bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-3 flex-shrink-0">
        <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-red-800 dark:text-red-300">
          Cannot connect to the server. Check that the dev server is running.
        </div>
      </div>
    );
  }

  const result = healthCheck.data;
  if (!result || result.healthy) return null;

  const messages: string[] = [];
  if (result.llm.message) messages.push(result.llm.message);
  if (result.embedding.message) messages.push(result.embedding.message);

  if (messages.length === 0) return null;

  const isCritical =
    result.llm.status !== "ok" || result.embedding.status !== "ok";

  const bgClass = isCritical
    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
    : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800";
  const textClass = isCritical
    ? "text-red-800 dark:text-red-300"
    : "text-amber-800 dark:text-amber-300";
  const iconClass = isCritical
    ? "text-red-600 dark:text-red-400"
    : "text-amber-600 dark:text-amber-400";

  return (
    <div
      className={`${bgClass} border-b px-4 py-3 flex items-start gap-3 flex-shrink-0`}
    >
      <AlertTriangle
        className={`h-5 w-5 ${iconClass} mt-0.5 flex-shrink-0`}
      />
      <div className={`text-sm ${textClass} space-y-1`}>
        {messages.map((msg, i) => (
          <p key={i}>{msg}</p>
        ))}
      </div>
    </div>
  );
}
