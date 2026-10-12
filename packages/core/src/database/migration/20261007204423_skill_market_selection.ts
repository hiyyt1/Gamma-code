import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261007204423_skill_market_selection",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`skill_market_selection\` (
          \`project_directory\` text NOT NULL,
          \`package_id\` text NOT NULL,
          \`revision\` text NOT NULL,
          CONSTRAINT \`skill_market_selection_pk\` PRIMARY KEY(\`project_directory\`, \`package_id\`)
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
