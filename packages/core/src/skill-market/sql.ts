import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

// Non-git projects share OpenCode's "global" project ID. Canonical directory
// identity keeps their selections isolated without changing project semantics.
export const SkillMarketSelectionTable = sqliteTable(
  "skill_market_selection",
  {
    project_directory: text().notNull(),
    package_id: text().notNull(),
    revision: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.project_directory, table.package_id] })],
)
