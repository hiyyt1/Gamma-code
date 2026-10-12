#!/usr/bin/env bun
import { randomBytes } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { Writable } from "node:stream"

const directory = process.argv[2]
if (!directory || !process.stdin.isTTY)
  throw new Error("Run interactively: bun deploy/setup-auth.ts /private/config/directory")
await mkdir(directory, { recursive: true, mode: 0o700 })
if (await Bun.file(path.join(directory, "auth.json")).exists())
  throw new Error("auth.json already exists; use a new private directory to prepare a rotation")
let hidden = false
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!hidden) process.stdout.write(chunk)
    callback()
  },
})
const terminal = createInterface({ input: process.stdin, output, terminal: true })
try {
  const username = (await terminal.question("Administrator login: ")).trim()
  if (!username || username.length > 128) throw new Error("Login must contain 1–128 characters")
  hidden = true
  process.stdout.write("Password (hidden, at least 12 characters): ")
  const password = await terminal.question("")
  process.stdout.write("\nRepeat password (hidden): ")
  const repeated = await terminal.question("")
  process.stdout.write("\n")
  if (password.length < 12 || password.length > 1024 || password !== repeated)
    throw new Error("Passwords must match and contain 12–1024 characters")
  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 })
  await writeFile(path.join(directory, "auth.json"), JSON.stringify({ username, passwordHash }) + "\n", {
    mode: 0o600,
    flag: "wx",
  })
  if (!(await Bun.file(path.join(directory, "backend.env")).exists())) {
    await writeFile(
      path.join(directory, "backend.env"),
      `OPENCODE_SERVER_USERNAME=gamma-internal\nOPENCODE_SERVER_PASSWORD=${randomBytes(48).toString("hex")}\n`,
      { mode: 0o600, flag: "wx" },
    )
  }
  process.stdout.write("Created private auth.json and backend.env. No password or service credential was printed.\n")
} finally {
  terminal.close()
}
