import { afterEach, expect, test } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

const passwordHash = await Bun.password.hash(randomBytes(24).toString("hex"), {
  algorithm: "argon2id",
  memoryCost: 65536,
  timeCost: 3,
})
const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

test.each([
  {
    name: "valid HTTPS configuration",
    origin: "https://gamma.example.test",
    mode: 0o600,
    hash: passwordHash,
    accepted: true,
  },
  {
    name: "loopback development configuration",
    origin: "http://localhost:4456",
    mode: 0o600,
    hash: passwordHash,
    accepted: true,
  },
  { name: "public HTTP", origin: "http://gamma.example.test", mode: 0o600, hash: passwordHash, accepted: false },
  {
    name: "world-readable credentials",
    origin: "https://gamma.example.test",
    mode: 0o644,
    hash: passwordHash,
    accepted: false,
  },
  {
    name: "plaintext password",
    origin: "https://gamma.example.test",
    mode: 0o600,
    hash: "not-a-hash",
    accepted: false,
  },
  {
    name: "weak Argon2 parameters",
    origin: "https://gamma.example.test",
    mode: 0o600,
    hash: passwordHash.replace("m=65536,t=3", "m=1024,t=1"),
    accepted: false,
  },
  {
    name: "missing administrator configuration",
    origin: "https://gamma.example.test",
    mode: 0o600,
    hash: passwordHash,
    accepted: false,
    missing: true,
  },
  {
    name: "missing backend protection",
    origin: "https://gamma.example.test",
    mode: 0o600,
    hash: passwordHash,
    accepted: false,
    unprotected: true,
  },
])("startup: $name", async (scenario) => {
  const folder = await mkdtemp(path.join(tmpdir(), "gamma-auth-config-"))
  folders.push(folder)
  const filename = path.join(folder, "auth.json")
  await writeFile(filename, JSON.stringify({ username: "test-admin", passwordHash: scenario.hash }), {
    mode: scenario.mode,
  })
  await chmod(filename, scenario.mode)
  const child = Bun.spawn(
    [process.execPath, "--eval", 'import { loadAuthConfig } from "./auth.ts"; await loadAuthConfig()'],
    {
      cwd: import.meta.dir,
      env: {
        GAMMA_PUBLIC_ORIGIN: scenario.origin,
        ...(scenario.missing ? {} : { GAMMA_AUTH_CONFIG: filename }),
        ...(scenario.unprotected ? {} : { OPENCODE_SERVER_PASSWORD: randomBytes(48).toString("hex") }),
      },
      stdout: "ignore",
      stderr: "ignore",
    },
  )
  expect((await child.exited) === 0).toBe(scenario.accepted)
})
