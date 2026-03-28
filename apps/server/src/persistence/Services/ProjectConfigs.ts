import { IsoDateTime, ProjectConfig, ProjectId, TrimmedNonEmptyString } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectConfigRow = Schema.Struct({
  projectId: ProjectId,
  primaryBranch: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type ProjectConfigRow = typeof ProjectConfigRow.Type;

export interface ProjectConfigRepositoryShape {
  readonly getById: (
    projectId: ProjectId,
  ) => Effect.Effect<ProjectConfig | null, ProjectionRepositoryError>;
  readonly upsert: (row: ProjectConfigRow) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteById: (projectId: ProjectId) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectConfigRepository extends ServiceMap.Service<
  ProjectConfigRepository,
  ProjectConfigRepositoryShape
>()("t3/persistence/Services/ProjectConfigs/ProjectConfigRepository") {}
