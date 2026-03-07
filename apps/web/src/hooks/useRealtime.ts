"use client";

import { useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UseRealtimeOptions<T> {
  table: string;
  filter?: string;
  onInsert?: (payload: T) => void;
  onUpdate?: (payload: T) => void;
  onDelete?: (payload: { old: T }) => void;
  enabled?: boolean;
}

export function useRealtime<T>({
  table,
  filter,
  onInsert,
  onUpdate,
  onDelete,
  enabled = true,
}: UseRealtimeOptions<T>) {
  useEffect(() => {
    if (!enabled) return;

    let channel: RealtimeChannel;

    const setupChannel = () => {
      channel = supabase
        .channel(`${table}-changes`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table,
            ...(filter && { filter }),
          },
          (payload) => {
            onInsert?.(payload.new as T);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table,
            ...(filter && { filter }),
          },
          (payload) => {
            onUpdate?.(payload.new as T);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table,
            ...(filter && { filter }),
          },
          (payload) => {
            onDelete?.({ old: payload.old as T });
          }
        )
        .subscribe();
    };

    setupChannel();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [table, filter, onInsert, onUpdate, onDelete, enabled]);
}

// Presence hook for typing indicators
export function usePresence(channelName: string) {
  const trackPresence = useCallback(
    async (state: Record<string, unknown>) => {
      const channel = supabase.channel(channelName);
      await channel.track(state);
    },
    [channelName]
  );

  return { trackPresence };
}

// Broadcast hook for ephemeral events (typing indicators, etc.)
export function useBroadcast<T>(channelName: string) {
  const broadcast = useCallback(
    async (event: string, payload: T) => {
      const channel = supabase.channel(channelName);
      await channel.send({
        type: "broadcast",
        event,
        payload,
      });
    },
    [channelName]
  );

  return { broadcast };
}
