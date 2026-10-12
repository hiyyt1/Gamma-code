import { Effect } from "effect"
import { Database } from "../../src/database/database"
import { SkillMarketSelectionTable } from "../../src/skill-market/sql"
import superpowers from "../../../../gamma-skill-market/packages/superpowers/manifest.json"

// Simulate a durable connection made before publication was retired.
export const seedLegacySkillConnection = Effect.fn("test.seedLegacySkillConnection")(function* (directory: string) {
  const database = yield* Database.Service
  yield* database.db
    .insert(SkillMarketSelectionTable)
    .values({ project_directory: directory, package_id: superpowers.id, revision: superpowers.revision })
    .run()
})
