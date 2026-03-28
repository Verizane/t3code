import type {
  GuidedThreadFinishInput,
  GuidedThreadFinishResult,
  GuidedThreadSetModeInput,
  GuidedThreadState,
  ProjectConfig,
  ProjectSetPrimaryBranchInput,
  ThreadId,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

import type { GuidedThreadServiceError } from "../Errors.ts";

export interface GuidedThreadServiceShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly getProjectConfig: (
    projectId: ProjectConfig["projectId"],
  ) => Effect.Effect<ProjectConfig, GuidedThreadServiceError>;
  readonly setProjectPrimaryBranch: (
    input: ProjectSetPrimaryBranchInput,
  ) => Effect.Effect<ProjectConfig, GuidedThreadServiceError>;
  readonly getThreadState: (
    threadId: ThreadId,
  ) => Effect.Effect<GuidedThreadState, GuidedThreadServiceError>;
  readonly setThreadMode: (
    input: GuidedThreadSetModeInput,
  ) => Effect.Effect<GuidedThreadState, GuidedThreadServiceError>;
  readonly finishThread: (
    input: GuidedThreadFinishInput,
  ) => Effect.Effect<GuidedThreadFinishResult, GuidedThreadServiceError>;
}

export class GuidedThreadService extends ServiceMap.Service<
  GuidedThreadService,
  GuidedThreadServiceShape
>()("t3/guided/Services/GuidedThreadService") {}
