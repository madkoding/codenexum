import { test, expect } from "bun:test"
import { IGNORE } from "../src/types"

// Regression test for a real-world hang: analyzing a project with a large
// ios/Pods, android/.gradle, or backend/.serverless tree (none previously in
// IGNORE) walks + hashes tens of thousands of vendored/generated files
// synchronously, blocking the whole app for every project, not just the one
// being analyzed.
test("IGNORE covers mobile build directories (React Native / Expo)", () => {
  expect(IGNORE.has("ios")).toBe(true)
  expect(IGNORE.has("android")).toBe(true)
  expect(IGNORE.has(".expo")).toBe(true)
  expect(IGNORE.has("Pods")).toBe(true)
  expect(IGNORE.has(".gradle")).toBe(true)
})

test("IGNORE covers serverless/IaC build output directories", () => {
  expect(IGNORE.has(".serverless")).toBe(true)
  expect(IGNORE.has("cdk.out")).toBe(true)
  expect(IGNORE.has(".terraform")).toBe(true)
})
