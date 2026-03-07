"use client";

import { useEffect } from "react";

// Suppress unhandled errors originating from browser extensions (e.g.
// extensions injecting globals). These have nothing to do with Radiology AI Assistant and
// only pollute the Next.js dev overlay.
export function SuppressExtensionErrors() {
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      if (event.filename?.startsWith("chrome-extension://") ||
          event.filename?.startsWith("moz-extension://") ||
          event.message?.includes("extension")) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    };
    window.addEventListener("error", handler, true);
    return () => window.removeEventListener("error", handler, true);
  }, []);

  return null;
}
