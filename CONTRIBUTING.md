# Contributing to CodeNexum

Thanks for your interest in contributing. CodeNexum is a small, focused
project and we keep the bar high so that nothing breaks for users.

## Ground rules

- **All work happens on `develop`.** `main` is protected and only receives
  merges from `develop`. Do not open PRs against `main` — they will be
  closed.
- **One issue, one PR.** Keep changes small and reviewable. If a fix needs
  a refactor first, do the refactor in its own PR.
- **No drive-by changes.** Don't reformat, rename, or "clean up" code that
  is unrelated to your change. It makes review and bisects impossible.
- **Tests are mandatory.** A PR without tests will not be merged. Coverage
  must stay at 100% across lines, branches, and functions.
- **Be honest about scope.** If you found something broken while working
  on something else, file an issue. Don't bundle fixes.

## Development setup

```bash
bun install
bun run typecheck
bun run test:coverage
```

The first command installs all workspace dependencies. The other two must
pass before you open a PR. Use `bun run dev` to launch the Electron app
during development.

## Branching

```
main         ← protected, only receives merges from develop
  └─ develop ← default integration branch
       └─ feat/short-kebab-description
       └─ fix/issue-123-short-description
       └─ chore/something-minor
```

Branch names do not have to follow conventional commits, but the **commit
messages and PR titles do**.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) strictly.
The CI bot will reject any PR whose title does not match the regex
`^(feat|fix|perf|refactor|test|docs|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: .+`.

Format:

```
<type>(<optional-scope>): <imperative summary under 72 chars>

<body explaining the why, wrapped at 100 chars>

<footer with "Closes #123", "BREAKING CHANGE: ..." when applicable>
```

Allowed types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`,
`ci`, `chore`, `revert`. A `!` after the type or a `BREAKING CHANGE:` footer
marks a breaking change.

Good examples:

```
feat(plugin): cache search results for 5 minutes
fix(mcp): handle EADDRINUSE by trying the next port
test(core): cover parseQuery edge cases with empty terms
docs(readme): document CODENEXUM_MCP_PORT env var
```

Bad examples (will be rejected):

```
update stuff
WIP
feat: add foo
feat(parser): Add Bar
```

## Pull requests

1. **Open an issue first** for non-trivial changes. The issue describes the
   problem; the PR describes the solution.
2. **Create a branch off `develop`** using the naming above.
3. **Fill the PR template completely.** The bot checks the template's
   required checkboxes. Empty sections are an automatic close.
4. **Make sure CI is green before requesting review.** PRs with failing
   CI are not reviewed.
5. **Keep the diff focused.** Reviewers will ask you to split large PRs.
6. **Squash-merge** is the default. Your PR title becomes the commit
   message on `develop`, so it must follow the conventional commit format.

CI runs:

- typecheck (`tsc -b`)
- unit tests with coverage gate (100% lines/branches/functions)
- commit-lint on the PR title
- build sanity (Electron + plugin)

## Issues

We use two templates: **bug report** and **feature request**. Anything
else belongs in Discussions. Issues that don't follow the template, or
that lack the required information, will be closed without triage.

Before opening a feature request, search existing issues and the
roadmap. The maintainer is the only one accepting features, so respect
their time: a clear problem statement is more valuable than a long wishlist.

## Testing policy

- Every PR must add or update tests for the behavior it changes.
- The coverage gate is 100% lines, 100% branches, 100% functions. If your
  change legitimately can't reach 100% (e.g. a defensive `process.exit`),
  add a `// ponytail:` comment explaining why and what the path looks like
  in production.
- Tests live next to their package: `packages/core/test/`,
  `packages/sql/test/`, etc. Use the existing test runner and helpers.
- Don't test private implementation details. Test behavior through the
  public API.

## Coding conventions

The repository's `AGENTS.md` is the source of truth. Highlights:

- TypeScript strict, ESNext, bundler resolution.
- **No comments** unless explaining a non-obvious decision (then mark
  with `// ponytail:` so it shows up in the debt ledger).
- Path aliases: `@codenexum/{core,sql,plugin,electron}`.
- Reach for the standard library before adding a dependency.

## Security

Do not file public issues for security problems. Use
[GitHub Security Advisories](https://github.com/madkoding/codenexum/security/advisories/new)
to report them privately.

## License

By contributing, you agree that your contributions are licensed under the
same terms as the project (see `LICENSE`).
