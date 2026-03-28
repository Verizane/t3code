import type { ProjectConfig, ProjectSearchEntriesResult } from "@t3tools/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  config: (projectId: string | null) => ["projects", "config", projectId] as const,
  searchEntries: (cwd: string | null, query: string, limit: number) =>
    ["projects", "search-entries", cwd, query, limit] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};

export function projectConfigQueryOptions(projectId: string | null) {
  return queryOptions({
    queryKey: projectQueryKeys.config(projectId),
    queryFn: async () => {
      if (!projectId) {
        throw new Error("Project config is unavailable.");
      }
      return ensureNativeApi().projects.getConfig({
        projectId: projectId as ProjectConfig["projectId"],
      });
    },
    enabled: projectId !== null,
    staleTime: 30_000,
  });
}

export function projectSetPrimaryBranchMutationOptions() {
  return mutationOptions({
    mutationKey: ["projects", "mutation", "set-primary-branch"] as const,
    mutationFn: async (input: { projectId: ProjectConfig["projectId"]; primaryBranch: string }) =>
      ensureNativeApi().projects.setPrimaryBranch(input),
  });
}

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}
