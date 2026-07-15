name: Feature request
description: Propose a new feature. Be specific about the problem and the proposed solution.
labels: ["type: feature"]
body:
  - type: markdown
    attributes:
      value: |
        Feature requests must explain the problem first, then the solution.
        "Add X" without a problem statement will be closed.

  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What user-facing problem does this solve? Who is affected and how often?
    validations:
      required: true

  - type: textarea
    id: proposal
    attributes:
      label: Proposed solution
      description: How should this work? Include API/UX details if you have them.
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
      description: What else did you consider and why is this better?
    validations:
      required: false

  - type: textarea
    id: scope
    attributes:
      label: Out of scope
      description: What will this PR NOT change? Be explicit.
    validations:
      required: true

  - type: textarea
    id: testing
    attributes:
      label: Testing plan
      description: How will you verify this works? What tests will you add to cover it?
    validations:
      required: true
