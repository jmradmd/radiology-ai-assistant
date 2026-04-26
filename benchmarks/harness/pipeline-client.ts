import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@rad-assist/api";

export class PipelineClientError extends Error {
  code: string | null;
  data: unknown;

  constructor(message: string, code: string | null, data: unknown) {
    super(message);
    this.name = "PipelineClientError";
    this.code = code;
    this.data = data;
  }
}

function createClient(baseUrl: string) {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl.replace(/\/$/, "")}/api/trpc`,
        transformer: superjson,
      }),
    ],
  });
}

export async function callBenchmarkStream(
  baseUrl: string,
  input: Parameters<ReturnType<typeof createClient>["rag"]["benchmarkStream"]["mutate"]>[0],
) {
  const client = createClient(baseUrl);
  try {
    return await client.rag.benchmarkStream.mutate(input);
  } catch (error) {
    const maybeTrpc = error as { message?: string; data?: { code?: string; httpStatus?: number } };
    throw new PipelineClientError(
      maybeTrpc.message || "Benchmark pipeline request failed",
      maybeTrpc.data?.code ?? null,
      maybeTrpc.data ?? null,
    );
  }
}
