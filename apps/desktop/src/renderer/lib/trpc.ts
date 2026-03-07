import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@rad-assist/api';

export const trpc = createTRPCReact<AppRouter>();

// Use localhost in development, production URL otherwise
const API_URL = 'http://localhost:3000/api/trpc';

export const createTrpcClient = (getToken: () => Promise<string | null>) => {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: API_URL,
        transformer: superjson,
        async headers() {
          try {
            const token = await getToken();
            return token ? { Authorization: `Bearer ${token}` } : {};
          } catch {
            return {};
          }
        },
      }),
    ],
  });
};
