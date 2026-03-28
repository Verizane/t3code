import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_configs (
      project_id TEXT PRIMARY KEY,
      primary_branch TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS guided_thread_states (
      thread_id TEXT PRIMARY KEY,
      workflow_mode TEXT NOT NULL,
      tracked_commit_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_configs_updated_at
    ON project_configs(updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_guided_thread_states_updated_at
    ON guided_thread_states(updated_at)
  `;
});
