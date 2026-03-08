import { router } from "./trpc";
import { userRouter } from "./routers/user";
import { conversationRouter } from "./routers/conversation";
import { messageRouter } from "./routers/message";
import { requestRouter } from "./routers/request";
import { scheduleRouter } from "./routers/schedule";
import { ragRouter } from "./routers/rag";
import { systemRouter } from "./routers/system";

export const appRouter = router({
  user: userRouter,
  conversation: conversationRouter,
  message: messageRouter,
  request: requestRouter,
  schedule: scheduleRouter,
  rag: ragRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
