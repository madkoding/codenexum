import { test, expect } from "bun:test"
import { isDenylistedPath } from "../src/denylist"

test("flags .env files", () => {
  expect(isDenylistedPath("/repo/.env")).toBe(true)
  expect(isDenylistedPath("/repo/.env.production")).toBe(true)
})

test("flags .aws directory contents", () => {
  expect(isDenylistedPath("/Users/me/.aws/credentials")).toBe(true)
})

test("flags .ssh directory contents", () => {
  expect(isDenylistedPath("/Users/me/.ssh/id_rsa")).toBe(true)
})

test("flags pem and key files", () => {
  expect(isDenylistedPath("/repo/certs/server.pem")).toBe(true)
  expect(isDenylistedPath("/repo/certs/server.key")).toBe(true)
})

test("flags .git internals", () => {
  expect(isDenylistedPath("/repo/.git/config")).toBe(true)
})

test("flags credentials-like files case-insensitively", () => {
  expect(isDenylistedPath("/repo/AWS_CREDENTIALS.json")).toBe(true)
})

test("flags cdk context and output", () => {
  expect(isDenylistedPath("/repo/cdk.context.json")).toBe(true)
  expect(isDenylistedPath("/repo/cdk.out/manifest.json")).toBe(true)
})

test("does not flag regular source files", () => {
  expect(isDenylistedPath("/repo/src/app.ts")).toBe(false)
  expect(isDenylistedPath("/repo/README.md")).toBe(false)
})

test("handles empty/undefined input", () => {
  expect(isDenylistedPath(undefined)).toBe(false)
  expect(isDenylistedPath(null)).toBe(false)
  expect(isDenylistedPath("")).toBe(false)
})
