name: Pull request
description: Every PR must pass CI, follow conventional commits, and include tests.
labels: []
body:
  - type: markdown
    attributes:
      value: |
        PRs that do not follow this template will be auto-closed by the bot.

  - type: dropdown
    id: type
    attributes:
      label: Change type
      description: Must match the conventional commit prefix in the title.
      options:
        - feat
        - fix
        - perf
        - refactor
        - test
        - docs
        - build
        - ci
        - chore
        - revert
    validations:
      required: true

  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: What changed and why? Reference the issue with `Closes #123` if applicable.
      placeholder: |
        - Closes #123
        - Replaces the inline parser with a shared `parseSourceFile` helper.
        - All call sites updated; behavior unchanged.
    validations:
      required: true

  - type: textarea
    id: scope
    attributes:
      label: Scope
      description: List the files and modules touched. Note any breaking changes explicitly.
    validations:
      required: true

  - type: textarea
    id: testing
    attributes:
      label: Testing
      description: |
        Every PR must add or update tests. Describe what you added.
        Coverage must stay at 100% (CI will fail otherwise).
      placeholder: |
        - `packages/core/test/search.test.ts` covers `parseQuery` edge cases.
        - `bun run test:coverage` reports 100% lines/branches/functions.
    validations:
      required: true

  - type: textarea
    id: checklist
    attributes:
      label: Checklist
      description: Confirm each item or this PR will not be merged.
    validations:
      required: true

  - type: checkboxes
    id: checks
    options:
      - label: Title follows Conventional Commits (e.g. `feat: add X`, `fix: handle Y`)
        required: true
      - label: `bun run typecheck` passes locally
        required: true
      - label: `bun run test:coverage` passes at 100% locally
        required: true
      - label: No unrelated changes (formatting, refactors outside scope)
        required: true
      - label: Documentation updated if behavior changed (README, AGENTS.md, comments)
        required: true
      - label: I understand that PRs to `main` are not accepted — all work goes through `develop`
        required: true
