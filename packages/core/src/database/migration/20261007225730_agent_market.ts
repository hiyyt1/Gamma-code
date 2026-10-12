import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261007225730_agent_market",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`agent_market_request\` (
          \`project_directory\` text NOT NULL,
          \`request_id\` text NOT NULL,
          \`agent_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`revision\` text NOT NULL,
          CONSTRAINT \`agent_market_request_pk\` PRIMARY KEY(\`project_directory\`, \`request_id\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`agent_market_selection\` (
          \`project_directory\` text PRIMARY KEY,
          \`agent_id\` text NOT NULL,
          \`version\` integer NOT NULL,
          \`revision\` text NOT NULL,
          \`skill_packages\` text NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
