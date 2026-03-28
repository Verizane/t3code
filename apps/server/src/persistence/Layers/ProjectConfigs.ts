import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { ProjectConfig } from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectConfigRepository,
  ProjectConfigRow,
  type ProjectConfigRepositoryShape,
} from "../Services/ProjectConfigs.ts";

const ProjectConfigDbRow = ProjectConfigRow;

const makeProjectConfigRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getProjectConfigRow = SqlSchema.findOne({
    Request: Schema.String,
    Result: ProjectConfigDbRow,
    execute: (projectId) =>
      sql`
        SELECT
          project_id AS "projectId",
          primary_branch AS "primaryBranch",
          updated_at AS "updatedAt"
        FROM project_configs
        WHERE project_id = ${projectId}
      `,
  });

  const upsertProjectConfigRow = SqlSchema.void({
    Request: ProjectConfigRow,
    execute: (row) =>
      sql`
        INSERT INTO project_configs (project_id, primary_branch, updated_at)
        VALUES (${row.projectId}, ${row.primaryBranch}, ${row.updatedAt})
        ON CONFLICT (project_id)
        DO UPDATE SET
          primary_branch = excluded.primary_branch,
          updated_at = excluded.updated_at
      `,
  });

  const deleteProjectConfigRow = SqlSchema.void({
    Request: Schema.String,
    execute: (projectId) =>
      sql`
        DELETE FROM project_configs
        WHERE project_id = ${projectId}
      `,
  });

  const getById: ProjectConfigRepositoryShape["getById"] = (projectId) =>
    getProjectConfigRow(projectId).pipe(
      Effect.map((row) => row satisfies ProjectConfig),
      Effect.catchTag("NoSuchElementError", () => Effect.succeed(null)),
      Effect.mapError(toPersistenceSqlError("ProjectConfigRepository.getById:query")),
    );

  const upsert: ProjectConfigRepositoryShape["upsert"] = (row) =>
    upsertProjectConfigRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectConfigRepository.upsert:query")),
    );

  const deleteById: ProjectConfigRepositoryShape["deleteById"] = (projectId) =>
    deleteProjectConfigRow(projectId).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectConfigRepository.deleteById:query")),
    );

  return {
    getById,
    upsert,
    deleteById,
  } satisfies ProjectConfigRepositoryShape;
});

export const ProjectConfigRepositoryLive = Layer.effect(
  ProjectConfigRepository,
  makeProjectConfigRepository,
);
