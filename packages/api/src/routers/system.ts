import { router, publicProcedure } from "../trpc";
import { checkProviderHealth } from "../lib/provider-health";

export const systemRouter = router({
  healthCheck: publicProcedure.query(async () => {
    return checkProviderHealth();
  }),
});
