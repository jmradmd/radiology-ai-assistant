import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@rad-assist/api";

export const trpc = createTRPCReact<AppRouter>();
