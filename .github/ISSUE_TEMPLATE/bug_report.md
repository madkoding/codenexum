name: Bug report
description: Report a reproducible bug. Fill every section; empty reports will be closed.
labels: ["type: bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to file a bug. Please complete every section below.
        Reports missing required information will be closed without triage.

  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: One or two sentences. What broke?
    validations:
      required: true

  - type: textarea
    id: repro
    attributes:
      label: Steps to reproduce
      description: Minimal, exact commands. Include a code snippet or test case if possible.
      placeholder: |
        1. `bun run --filter @codenexum/plugin build`
        2. Open the Electron app
        3. Run `cm_search` for "foo"
        4. See error
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      description: What did you expect to happen?
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
      description: What actually happened? Paste the full error or output.
    validations:
      required: true

  - type: input
    id: version
    attributes:
      label: Version
      description: Output of `codenexum --version` or the version shown in the tray menu.
      placeholder: 0.99.9
    validations:
      required: true

  - type: dropdown
    id: os
    attributes:
      label: OS
      options:
        - macOS
        - Windows
        - Linux
    validations:
      required: true

  - type: textarea
    id: context
    attributes:
      label: Additional context
      description: Logs, screenshots, related issues, anything that helps reproduce.
    validations:
      required: false
