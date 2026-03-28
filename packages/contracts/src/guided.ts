import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const ThreadWorkflowMode = Schema.Literals(["normal", "guided"]);
export type ThreadWorkflowMode = typeof ThreadWorkflowMode.Type;
export const DEFAULT_THREAD_WORKFLOW_MODE: ThreadWorkflowMode = "normal";

export const GuidedThreadGetStateInput = Schema.Struct({
  threadId: ThreadId,
});
export type GuidedThreadGetStateInput = typeof GuidedThreadGetStateInput.Type;

export const GuidedThreadSetModeInput = Schema.Struct({
  threadId: ThreadId,
  workflowMode: ThreadWorkflowMode,
});
export type GuidedThreadSetModeInput = typeof GuidedThreadSetModeInput.Type;

export const GuidedThreadFinishInput = Schema.Struct({
  threadId: ThreadId,
});
export type GuidedThreadFinishInput = typeof GuidedThreadFinishInput.Type;

export const GuidedThreadState = Schema.Struct({
  threadId: ThreadId,
  workflowMode: ThreadWorkflowMode,
  trackedCommitCount: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type GuidedThreadState = typeof GuidedThreadState.Type;

export const GuidedThreadFinishResult = Schema.Struct({
  threadId: ThreadId,
  workflowMode: ThreadWorkflowMode,
  trackedCommitCount: NonNegativeInt,
  commitSha: TrimmedNonEmptyString,
  subject: TrimmedNonEmptyString,
  body: Schema.String,
  updatedAt: IsoDateTime,
});
export type GuidedThreadFinishResult = typeof GuidedThreadFinishResult.Type;
