import {
  CommandId,
  DEFAULT_PROJECT_PRIMARY_BRANCH,
  DEFAULT_THREAD_WORKFLOW_MODE,
  EventId,
  type GuidedThreadFinishResult,
  type GuidedThreadState,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type ProjectConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { Cause, Effect, Layer, Stream } from "effect";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { GuidedThreadStateRepository } from "../../persistence/Services/GuidedThreadStates.ts";
import { ProjectConfigRepository } from "../../persistence/Services/ProjectConfigs.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { GuidedThreadServiceError } from "../Errors.ts";
import {
  GuidedThreadService,
  type GuidedThreadServiceShape,
} from "../Services/GuidedThreadService.ts";

const BACKUP_REF_PREFIX = "refs/t3code/guided";
const MAX_DIFF_SUMMARY_CHARS = 8_000;
const MAX_DIFF_PATCH_CHARS = 50_000;

function guidedError(operation: string, detail: string, cause?: unknown): GuidedThreadServiceError {
  return new GuidedThreadServiceError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function limitContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function sanitizeCommitMessage(generated: { subject: string; body: string }): {
  subject: string;
  body: string;
} {
  const rawSubject = generated.subject.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const subject = rawSubject.replace(/[.]+$/g, "").trim();
  return {
    subject: subject.length > 0 ? subject.slice(0, 72).trimEnd() : "Summarize guided work",
    body: generated.body.trim(),
  };
}

type ThreadContext = {
  thread: OrchestrationReadModel["threads"][number];
  project: OrchestrationReadModel["projects"][number];
  cwd: string;
};

export const makeGuidedThreadService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectConfigRepository = yield* ProjectConfigRepository;
  const guidedThreadStateRepository = yield* GuidedThreadStateRepository;
  const gitCore = yield* GitCore;
  const textGeneration = yield* TextGeneration;
  const serverSettingsService = yield* ServerSettingsService;

  const ignoreFailure = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
    effect.pipe(
      Effect.catch(() => Effect.void),
      Effect.asVoid,
    );

  const appendActivity = (input: {
    threadId: ThreadId;
    tone: "info" | "error";
    kind: string;
    summary: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }): Effect.Effect<void, GuidedThreadServiceError> =>
    orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId: CommandId.makeUnsafe(`server:guided:${crypto.randomUUID()}`),
        threadId: input.threadId,
        activity: {
          id: EventId.makeUnsafe(crypto.randomUUID()),
          tone: input.tone,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: null,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      })
      .pipe(
        Effect.asVoid,
        Effect.mapError((error) =>
          guidedError("appendActivity", "Failed to append guided activity.", error),
        ),
      );

  const resolveThreadContext = (
    threadId: ThreadId,
  ): Effect.Effect<ThreadContext, GuidedThreadServiceError> =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find(
        (entry) => entry.id === threadId && entry.deletedAt === null,
      );
      if (!thread) {
        return yield* Effect.fail(
          guidedError("resolveThreadContext", `Thread "${threadId}" was not found.`),
        );
      }

      const project = readModel.projects.find(
        (entry) => entry.id === thread.projectId && entry.deletedAt === null,
      );
      if (!project) {
        return yield* Effect.fail(
          guidedError(
            "resolveThreadContext",
            `Project "${thread.projectId}" for thread "${threadId}" was not found.`,
          ),
        );
      }

      const cwd = resolveThreadWorkspaceCwd({
        thread: {
          projectId: thread.projectId,
          worktreePath: thread.worktreePath,
        },
        projects: readModel.projects.map((entry) => ({
          id: entry.id,
          workspaceRoot: entry.workspaceRoot,
        })),
      });
      if (!cwd) {
        return yield* Effect.fail(
          guidedError(
            "resolveThreadContext",
            `Thread "${threadId}" does not have a workspace path.`,
          ),
        );
      }

      return { thread, project, cwd };
    });

  const getProjectConfig: GuidedThreadServiceShape["getProjectConfig"] = (projectId) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const project = readModel.projects.find(
        (entry) => entry.id === projectId && entry.deletedAt === null,
      );
      if (!project) {
        return yield* Effect.fail(
          guidedError("getProjectConfig", `Project "${projectId}" was not found.`),
        );
      }

      const row = yield* projectConfigRepository
        .getById(projectId)
        .pipe(
          Effect.mapError((error) =>
            guidedError("getProjectConfig", "Failed to load project config.", error),
          ),
        );

      return {
        projectId,
        primaryBranch: row?.primaryBranch ?? DEFAULT_PROJECT_PRIMARY_BRANCH,
        updatedAt: row?.updatedAt ?? project.updatedAt,
      } satisfies ProjectConfig;
    });

  const getThreadState: GuidedThreadServiceShape["getThreadState"] = (threadId) =>
    Effect.gen(function* () {
      const { thread } = yield* resolveThreadContext(threadId);
      const row = yield* guidedThreadStateRepository
        .getById(threadId)
        .pipe(
          Effect.mapError((error) =>
            guidedError("getThreadState", "Failed to load guided thread state.", error),
          ),
        );

      return {
        threadId,
        workflowMode: row?.workflowMode ?? DEFAULT_THREAD_WORKFLOW_MODE,
        trackedCommitCount: row?.trackedCommitCount ?? 0,
        updatedAt: row?.updatedAt ?? thread.updatedAt,
      } satisfies GuidedThreadState;
    });

  const stageAll = (cwd: string) =>
    gitCore
      .execute({
        operation: "GuidedThreadService.stageAll",
        cwd,
        args: ["add", "-A", "--", "."],
      })
      .pipe(Effect.asVoid);

  const rebaseOntoPrimary = (input: {
    cwd: string;
    primaryBranch: string;
    threadId: ThreadId;
    createdAt: string;
  }): Effect.Effect<void, GuidedThreadServiceError> =>
    gitCore
      .execute({
        operation: "GuidedThreadService.rebaseOntoPrimary",
        cwd: input.cwd,
        args: ["rebase", input.primaryBranch],
      })
      .pipe(
        Effect.asVoid,
        Effect.mapError((error) =>
          guidedError(
            "rebaseOntoPrimary",
            `Failed to rebase onto "${input.primaryBranch}".`,
            error,
          ),
        ),
        Effect.catch((error) =>
          ignoreFailure(
            gitCore.execute({
              operation: "GuidedThreadService.rebaseAbort",
              cwd: input.cwd,
              args: ["rebase", "--abort"],
              allowNonZeroExit: true,
            }),
          ).pipe(
            Effect.flatMap(() =>
              ignoreFailure(
                appendActivity({
                  threadId: input.threadId,
                  tone: "error",
                  kind: "guided.rebase.failed",
                  summary: "Guided rebase failed",
                  payload: {
                    primaryBranch: input.primaryBranch,
                    detail: error.detail,
                  },
                  createdAt: input.createdAt,
                }),
              ),
            ),
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      );

  const readLatestTrackedCommits = (input: {
    cwd: string;
    trackedCommitCount: number;
  }): Effect.Effect<ReadonlyArray<string>, GuidedThreadServiceError> =>
    gitCore
      .execute({
        operation: "GuidedThreadService.readLatestTrackedCommits",
        cwd: input.cwd,
        args: ["rev-list", "--reverse", "-n", String(input.trackedCommitCount), "HEAD"],
      })
      .pipe(
        Effect.map((result) =>
          result.stdout
            .split(/\r?\n/g)
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        ),
        Effect.mapError((error) =>
          guidedError("readLatestTrackedCommits", "Failed to resolve guided commits.", error),
        ),
      );

  const readCommitRangeContext = (input: {
    cwd: string;
    parentCommit: string;
  }): Effect.Effect<
    {
      stagedSummary: string;
      stagedPatch: string;
    },
    GuidedThreadServiceError
  > =>
    Effect.all([
      gitCore.execute({
        operation: "GuidedThreadService.readCommitRangeContext.summary",
        cwd: input.cwd,
        args: ["diff", "--stat", "--find-renames", `${input.parentCommit}..HEAD`, "--"],
      }),
      gitCore.execute({
        operation: "GuidedThreadService.readCommitRangeContext.patch",
        cwd: input.cwd,
        args: ["diff", "--binary", "--find-renames", `${input.parentCommit}..HEAD`, "--"],
      }),
    ]).pipe(
      Effect.map(([summaryResult, patchResult]) => ({
        stagedSummary: summaryResult.stdout.trim(),
        stagedPatch: patchResult.stdout.trim(),
      })),
      Effect.mapError((error) =>
        guidedError("readCommitRangeContext", "Failed to read guided commit diff.", error),
      ),
    );

  const createGuidedWipCommit = (input: {
    threadId: ThreadId;
    createdAt: string;
    appendSuccessActivity?: boolean;
  }): Effect.Effect<GuidedThreadState, GuidedThreadServiceError> =>
    Effect.gen(function* () {
      const state = yield* getThreadState(input.threadId);
      if (state.workflowMode !== "guided") {
        return state;
      }

      const { cwd, project } = yield* resolveThreadContext(input.threadId);
      const projectConfig = yield* getProjectConfig(project.id);
      const status = yield* gitCore
        .statusDetails(cwd)
        .pipe(
          Effect.mapError((error) =>
            guidedError("createGuidedWipCommit", "Failed to read git status.", error),
          ),
        );
      if (!status.hasWorkingTreeChanges) {
        return state;
      }

      yield* stageAll(cwd).pipe(
        Effect.mapError((error) =>
          guidedError("createGuidedWipCommit", "Failed to stage guided changes.", error),
        ),
      );

      const nextCount = state.trackedCommitCount + 1;
      const subject = `WIP: guided thread ${nextCount}`;
      const commit = yield* gitCore
        .commit(cwd, subject, "")
        .pipe(
          Effect.mapError((error) =>
            guidedError("createGuidedWipCommit", "Failed to create guided WIP commit.", error),
          ),
        );

      const nextState: GuidedThreadState = {
        threadId: input.threadId,
        workflowMode: "guided",
        trackedCommitCount: nextCount,
        updatedAt: input.createdAt,
      };
      yield* guidedThreadStateRepository
        .upsert(nextState)
        .pipe(
          Effect.mapError((error) =>
            guidedError("createGuidedWipCommit", "Failed to persist guided thread state.", error),
          ),
        );

      yield* rebaseOntoPrimary({
        cwd,
        primaryBranch: projectConfig.primaryBranch,
        threadId: input.threadId,
        createdAt: input.createdAt,
      });

      if (input.appendSuccessActivity !== false) {
        yield* ignoreFailure(
          appendActivity({
            threadId: input.threadId,
            tone: "info",
            kind: "guided.wip-commit.created",
            summary: "Guided WIP commit created",
            payload: {
              primaryBranch: projectConfig.primaryBranch,
              commitSha: commit.commitSha,
              subject,
              trackedCommitCount: nextCount,
            },
            createdAt: input.createdAt,
          }),
        );
      }

      return nextState;
    });

  const setProjectPrimaryBranch: GuidedThreadServiceShape["setProjectPrimaryBranch"] = (input) =>
    Effect.gen(function* () {
      const current = yield* getProjectConfig(input.projectId);
      const nextUpdatedAt = new Date().toISOString();
      const nextConfig: ProjectConfig = {
        ...current,
        primaryBranch: input.primaryBranch,
        updatedAt: nextUpdatedAt,
      };
      yield* projectConfigRepository
        .upsert(nextConfig)
        .pipe(
          Effect.mapError((error) =>
            guidedError("setProjectPrimaryBranch", "Failed to persist the primary branch.", error),
          ),
        );
      return nextConfig;
    });

  const setThreadMode: GuidedThreadServiceShape["setThreadMode"] = (input) =>
    Effect.gen(function* () {
      const current = yield* getThreadState(input.threadId);
      const updatedAt = new Date().toISOString();

      if (input.workflowMode === "normal") {
        yield* guidedThreadStateRepository
          .deleteById(input.threadId)
          .pipe(
            Effect.mapError((error) =>
              guidedError("setThreadMode", "Failed to clear guided thread state.", error),
            ),
          );
        return {
          ...current,
          workflowMode: "normal",
          trackedCommitCount: 0,
          updatedAt,
        } satisfies GuidedThreadState;
      }

      const nextState: GuidedThreadState = {
        threadId: input.threadId,
        workflowMode: "guided",
        trackedCommitCount: current.trackedCommitCount,
        updatedAt,
      };
      yield* guidedThreadStateRepository
        .upsert(nextState)
        .pipe(
          Effect.mapError((error) =>
            guidedError("setThreadMode", "Failed to persist guided thread state.", error),
          ),
        );
      return nextState;
    });

  const finishThread: GuidedThreadServiceShape["finishThread"] = (input) =>
    Effect.gen(function* () {
      const { thread, cwd } = yield* resolveThreadContext(input.threadId);
      const projectConfig = yield* getProjectConfig(thread.projectId);

      let state = yield* getThreadState(input.threadId);
      if (state.workflowMode !== "guided") {
        return yield* Effect.fail(
          guidedError("finishThread", `Thread "${input.threadId}" is not in guided mode.`),
        );
      }

      const finishedAt = new Date().toISOString();
      state = yield* createGuidedWipCommit({
        threadId: input.threadId,
        createdAt: finishedAt,
        appendSuccessActivity: false,
      });
      if (state.trackedCommitCount <= 0) {
        return yield* Effect.fail(
          guidedError("finishThread", "There are no guided commits to squash."),
        );
      }

      yield* rebaseOntoPrimary({
        cwd,
        primaryBranch: projectConfig.primaryBranch,
        threadId: input.threadId,
        createdAt: finishedAt,
      });

      const trackedCommits = yield* readLatestTrackedCommits({
        cwd,
        trackedCommitCount: state.trackedCommitCount,
      });
      const oldestCommit = trackedCommits[0];
      if (!oldestCommit || trackedCommits.length !== state.trackedCommitCount) {
        return yield* Effect.fail(
          guidedError(
            "finishThread",
            "Tracked guided commits could not be resolved from the current branch.",
          ),
        );
      }

      const parentCommit = (yield* gitCore
        .execute({
          operation: "GuidedThreadService.finishThread.parentCommit",
          cwd,
          args: ["rev-parse", `${oldestCommit}^`],
        })
        .pipe(
          Effect.mapError((error) =>
            guidedError("finishThread", "Failed to resolve the guided commit base.", error),
          ),
        )).stdout.trim();
      if (parentCommit.length === 0) {
        return yield* Effect.fail(
          guidedError("finishThread", "Failed to resolve the guided commit base."),
        );
      }

      const rangeContext = yield* readCommitRangeContext({ cwd, parentCommit });
      if (rangeContext.stagedSummary.length === 0 && rangeContext.stagedPatch.length === 0) {
        return yield* Effect.fail(
          guidedError("finishThread", "Guided commits did not produce a diff."),
        );
      }

      const modelSelection: ModelSelection = yield* serverSettingsService.getSettings.pipe(
        Effect.map((settings) => settings.textGenerationModelSelection),
        Effect.mapError((error) =>
          guidedError("finishThread", "Failed to load text generation settings.", error),
        ),
      );
      const status = yield* gitCore
        .statusDetails(cwd)
        .pipe(
          Effect.mapError((error) =>
            guidedError("finishThread", "Failed to inspect the current branch.", error),
          ),
        );
      const generated = yield* textGeneration
        .generateCommitMessage({
          cwd,
          branch: status.branch,
          stagedSummary: limitContext(rangeContext.stagedSummary, MAX_DIFF_SUMMARY_CHARS),
          stagedPatch: limitContext(rangeContext.stagedPatch, MAX_DIFF_PATCH_CHARS),
          modelSelection,
        })
        .pipe(
          Effect.map(sanitizeCommitMessage),
          Effect.mapError((error) =>
            guidedError("finishThread", "Failed to summarize guided changes.", error),
          ),
        );

      const backupRef = `${BACKUP_REF_PREFIX}/${input.threadId}/pre-finish`;
      yield* gitCore
        .execute({
          operation: "GuidedThreadService.finishThread.backupRef",
          cwd,
          args: ["update-ref", backupRef, "HEAD"],
        })
        .pipe(
          Effect.mapError((error) =>
            guidedError("finishThread", "Failed to write guided backup ref.", error),
          ),
        );

      const restoreFromBackup = ignoreFailure(
        gitCore.execute({
          operation: "GuidedThreadService.finishThread.restoreBackup",
          cwd,
          args: ["reset", "--hard", backupRef],
          allowNonZeroExit: true,
        }),
      );
      const cleanupBackup = ignoreFailure(
        gitCore.execute({
          operation: "GuidedThreadService.finishThread.cleanupBackup",
          cwd,
          args: ["update-ref", "-d", backupRef],
          allowNonZeroExit: true,
        }),
      );

      return yield* Effect.gen(function* () {
        yield* gitCore
          .execute({
            operation: "GuidedThreadService.finishThread.resetSoft",
            cwd,
            args: ["reset", "--soft", parentCommit],
          })
          .pipe(
            Effect.mapError((error) =>
              guidedError("finishThread", "Failed to reset guided commits for squashing.", error),
            ),
          );
        const commit = yield* gitCore
          .commit(cwd, generated.subject, generated.body)
          .pipe(
            Effect.mapError((error) =>
              guidedError("finishThread", "Failed to create the final guided commit.", error),
            ),
          );
        yield* guidedThreadStateRepository
          .deleteById(input.threadId)
          .pipe(
            Effect.mapError((error) =>
              guidedError("finishThread", "Failed to clear guided thread state.", error),
            ),
          );
        yield* ignoreFailure(
          appendActivity({
            threadId: input.threadId,
            tone: "info",
            kind: "guided.finished",
            summary: "Guided thread finished",
            payload: {
              primaryBranch: projectConfig.primaryBranch,
              commitSha: commit.commitSha,
              subject: generated.subject,
            },
            createdAt: finishedAt,
          }),
        );

        return {
          threadId: input.threadId,
          workflowMode: "normal",
          trackedCommitCount: 0,
          commitSha: commit.commitSha,
          subject: generated.subject,
          body: generated.body,
          updatedAt: finishedAt,
        } satisfies GuidedThreadFinishResult;
      }).pipe(
        Effect.catch((error) =>
          restoreFromBackup.pipe(
            Effect.flatMap(() =>
              ignoreFailure(
                appendActivity({
                  threadId: input.threadId,
                  tone: "error",
                  kind: "guided.finish.failed",
                  summary: "Guided finish failed",
                  payload: { detail: error.detail },
                  createdAt: finishedAt,
                }),
              ),
            ),
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
        Effect.ensuring(cleanupBackup),
      );
    });

  const processDomainEvent = (event: OrchestrationEvent): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      if (event.type === "thread.deleted") {
        yield* ignoreFailure(guidedThreadStateRepository.deleteById(event.payload.threadId));
        return;
      }
      if (event.type !== "thread.turn-diff-completed") {
        return;
      }

      const createdAt = new Date().toISOString();
      yield* createGuidedWipCommit({
        threadId: event.payload.threadId,
        createdAt,
      }).pipe(
        Effect.asVoid,
        Effect.catch((error) =>
          ignoreFailure(
            appendActivity({
              threadId: event.payload.threadId,
              tone: "error",
              kind: "guided.wip-commit.failed",
              summary: "Guided WIP commit failed",
              payload: { detail: error.detail },
              createdAt,
            }),
          ),
        ),
      );
    });

  const start: GuidedThreadServiceShape["start"] = Stream.runForEach(
    orchestrationEngine.streamDomainEvents,
    (event) => {
      if (event.type !== "thread.turn-diff-completed" && event.type !== "thread.deleted") {
        return Effect.void;
      }

      return processDomainEvent(event).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning("guided thread service failed to process domain event", {
            eventType: event.type,
            cause: Cause.pretty(cause),
          });
        }),
      );
    },
  ).pipe(Effect.forkScoped, Effect.asVoid);

  return {
    start,
    getProjectConfig,
    setProjectPrimaryBranch,
    getThreadState,
    setThreadMode,
    finishThread,
  } satisfies GuidedThreadServiceShape;
});

export const GuidedThreadServiceLive = Layer.effect(GuidedThreadService, makeGuidedThreadService);
