import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GuidedThreadStateRepository,
  GuidedThreadStateRow,
  type GuidedThreadStateRepositoryShape,
} from "../Services/GuidedThreadStates.ts";

const GuidedThreadStateDbRow = GuidedThreadStateRow;

const makeGuidedThreadStateRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getGuidedThreadStateRow = SqlSchema.findOne({
    Request: Schema.String,
    Result: GuidedThreadStateDbRow,
    execute: (threadId) =>
      sql`
        SELECT
          thread_id AS "threadId",
          workflow_mode AS "workflowMode",
          tracked_commit_count AS "trackedCommitCount",
          updated_at AS "updatedAt"
        FROM guided_thread_states
        WHERE thread_id = ${threadId}
      `,
  });

  const upsertGuidedThreadStateRow = SqlSchema.void({
    Request: GuidedThreadStateRow,
    execute: (row) =>
      sql`
        INSERT INTO guided_thread_states (
          thread_id,
          workflow_mode,
          tracked_commit_count,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.workflowMode},
          ${row.trackedCommitCount},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          workflow_mode = excluded.workflow_mode,
          tracked_commit_count = excluded.tracked_commit_count,
          updated_at = excluded.updated_at
      `,
  });

  const deleteGuidedThreadStateRow = SqlSchema.void({
    Request: Schema.String,
    execute: (threadId) =>
      sql`
        DELETE FROM guided_thread_states
        WHERE thread_id = ${threadId}
      `,
  });

  const getById: GuidedThreadStateRepositoryShape["getById"] = (threadId) =>
    getGuidedThreadStateRow(threadId).pipe(
      Effect.catchTag("NoSuchElementError", () => Effect.succeed(null)),
      Effect.mapError(toPersistenceSqlError("GuidedThreadStateRepository.getById:query")),
    );

  const upsert: GuidedThreadStateRepositoryShape["upsert"] = (row) =>
    upsertGuidedThreadStateRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("GuidedThreadStateRepository.upsert:query")),
    );

  const deleteById: GuidedThreadStateRepositoryShape["deleteById"] = (threadId) =>
    deleteGuidedThreadStateRow(threadId).pipe(
      Effect.mapError(toPersistenceSqlError("GuidedThreadStateRepository.deleteById:query")),
    );

  return {
    getById,
    upsert,
    deleteById,
  } satisfies GuidedThreadStateRepositoryShape;
});

export const GuidedThreadStateRepositoryLive = Layer.effect(
  GuidedThreadStateRepository,
  makeGuidedThreadStateRepository,
);
