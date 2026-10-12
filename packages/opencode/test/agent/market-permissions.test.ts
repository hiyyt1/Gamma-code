import { expect, test } from "bun:test"
import { Permission } from "../../src/permission"

test("project and platform restrictions cannot be relaxed by agents, sessions or remembered approvals", () => {
  const policy = Permission.intersect(
    Permission.fromConfig({ "*": "allow", read: { "*": "allow", "*.env": "deny" }, bash: "ask" }),
    Permission.fromConfig({ "*": "allow", edit: "deny", task: { "*": "deny", "gamma-qa-engineer": "ask" } }),
  )
  const session = Permission.fromConfig({ "*": "allow" })
  const approved = Permission.fromConfig({ bash: "allow", read: "allow", task: "allow", edit: "allow" })
  expect(Permission.evaluate("read", "public.ts", policy, Permission.fromConfig({ bash: "deny" })).action).toBe("allow")
  expect(Permission.evaluate("read", ".env", policy, session, approved).action).toBe("deny")
  expect(Permission.evaluate("edit", "file.ts", policy, session, approved).action).toBe("deny")
  expect(Permission.evaluate("bash", "echo hello", policy, session, approved).action).toBe("ask")
  expect(Permission.evaluate("task", "gamma-qa-engineer", policy, session, approved).action).toBe("ask")
  expect(Permission.evaluate("task", "general", policy, session, approved).action).toBe("deny")
  expect(Permission.disabled(["task", "edit", "write", "read"], Permission.merge(policy, session))).toEqual(
    new Set(["edit", "write"]),
  )
  expect(Permission.evaluate("read", "a.ts", policy, Permission.fromConfig({ read: "deny" })).action).toBe("deny")
})

test("ordinary projects retain legacy last-match permission behavior", () => {
  expect(
    Permission.evaluate(
      "bash",
      "echo hello",
      Permission.fromConfig({ bash: "ask" }),
      Permission.fromConfig({ bash: "allow" }),
    ).action,
  ).toBe("allow")
})
