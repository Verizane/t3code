import { IsoDateTime, NonNegativeInt, ThreadId, ThreadWorkflowMode } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const GuidedThreadStateRow = Schema.Struct({
  threadId: ThreadId,
  workflowMode: ThreadWorkflowMode,
  trackedCommitCount: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type GuidedThreadStateRow = typeof GuidedThreadStateRow.Type;

export interface GuidedThreadStateRepositoryShape {
  readonly getById: (
    threadId: ThreadId,
  ) => Effect.Effect<GuidedThreadStateRow | null, ProjectionRepositoryError>;
  readonly upsert: (row: GuidedThreadStateRow) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteById: (threadId: ThreadId) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class GuidedThreadStateRepository extends ServiceMap.Service<
  GuidedThreadStateRepository,
  GuidedThreadStateRepositoryShape
>()("t3/persistence/Services/GuidedThreadStates/GuidedThreadStateRepository") {}
