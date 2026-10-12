import { integer, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core"

export const AgentMarketSelectionTable = sqliteTable("agent_market_selection", {
  project_directory: text().primaryKey(),
  agent_id: text().notNull(),
  version: integer().notNull(),
  revision: text().notNull(),
  skill_packages: text({ mode: "json" }).$type<{ package_id: string; revision: string }[]>().notNull(),
})

export const AgentMarketRequestTable = sqliteTable(
  "agent_market_request",
  {
    project_directory: text().notNull(),
    request_id: text().notNull(),
    agent_id: text().notNull(),
    session_id: text().notNull(),
    version: integer().notNull(),
    revision: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.project_directory, table.request_id] })],
)
