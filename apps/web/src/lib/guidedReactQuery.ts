import type { ThreadId, ThreadWorkflowMode } from "@t3tools/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "../nativeApi";

export const guidedQueryKeys = {
  all: ["guided"] as const,
  threadState: (threadId: ThreadId | null) => ["guided", "thread-state", threadId] as const,
};

export function guidedThreadStateQueryOptions(threadId: ThreadId | null) {
  return queryOptions({
    queryKey: guidedQueryKeys.threadState(threadId),
    queryFn: async () => {
      if (!threadId) {
        throw new Error("Guided thread state is unavailable.");
      }
      return ensureNativeApi().guided.getThreadState({ threadId });
    },
    enabled: threadId !== null,
    staleTime: 15_000,
  });
}

export function guidedSetThreadModeMutationOptions() {
  return mutationOptions({
    mutationKey: ["guided", "mutation", "set-thread-mode"] as const,
    mutationFn: async (input: { threadId: ThreadId; workflowMode: ThreadWorkflowMode }) =>
      ensureNativeApi().guided.setThreadMode(input),
  });
}

export function guidedFinishThreadMutationOptions() {
  return mutationOptions({
    mutationKey: ["guided", "mutation", "finish-thread"] as const,
    mutationFn: async (input: { threadId: ThreadId }) =>
      ensureNativeApi().guided.finishThread(input),
  });
}
