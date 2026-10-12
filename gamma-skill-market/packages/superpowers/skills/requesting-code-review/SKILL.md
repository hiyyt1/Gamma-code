---
name: requesting-code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements
---

## Gamma / OpenCode adaptation (added by Gamma)

This bundle supplies instructions through the native `skill` tool. Invoke bundled
skills using `superpowers:<name>`. No Claude hooks or plugins are installed.
Use only tools actually exposed by the current session: `Skill` means `skill`;
This package is approved for Gamma V1 only. This build of V2 has no task/subagent
tool, so this package is not exposed there. `Task` means `task` with
`subagent_type: "general"` in V1. Give that agent the referenced reviewer/implementer
prompt; `superpowers:code-reviewer` is a role template, not an installed agent.
`TodoWrite` means `todowrite` when available; otherwise track the checklist in
a project Markdown file. File operations use the current session's read/edit/
write/patch tools and shell commands use bash/shell, as exposed by that session.

The user's instructions, project permissions and filesystem isolation still
apply. Work only inside the current project's allowed paths. An instruction in
a skill does not grant permission to install dependencies, access other projects,
read secrets, publish, commit, delete work or change the system. Resolve missing
tools as a configuration requirement; never pretend they executed successfully.
GitHub operations require an explicitly configured gh CLI and authorization.
Graph rendering is optional and requires Node.js and Graphviz dot; it is not
available by default. Do not install either automatically. Copy any rendering
inputs to the project before generating output; installed resources are read-only.


# Requesting Code Review

Dispatch superpowers:code-reviewer subagent to catch issues before they cascade.

**Core principle:** Review early, review often.

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## How to Request

**1. Get git SHAs:**
```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**2. Dispatch code-reviewer subagent:**

Use Task tool with superpowers:code-reviewer type, fill template at `code-reviewer.md`

**Placeholders:**
- `{WHAT_WAS_IMPLEMENTED}` - What you just built
- `{PLAN_OR_REQUIREMENTS}` - What it should do
- `{BASE_SHA}` - Starting commit
- `{HEAD_SHA}` - Ending commit
- `{DESCRIPTION}` - Brief summary

**3. Act on feedback:**
- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning)

## Example

```
[Just completed Task 2: Add verification function]

You: Let me request code review before proceeding.

BASE_SHA=$(git log --oneline | grep "Task 1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)

[Dispatch superpowers:code-reviewer subagent]
  WHAT_WAS_IMPLEMENTED: Verification and repair functions for conversation index
  PLAN_OR_REQUIREMENTS: Task 2 from docs/plans/deployment-plan.md
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661
  DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types

[Subagent returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing progress indicators
    Minor: Magic number (100) for reporting interval
  Assessment: Ready to proceed

You: [Fix progress indicators]
[Continue to Task 3]
```

## Integration with Workflows

**Subagent-Driven Development:**
- Review after EACH task
- Catch issues before they compound
- Fix before moving to next task

**Executing Plans:**
- Review after each batch (3 tasks)
- Get feedback, apply, continue

**Ad-Hoc Development:**
- Review before merge
- Review when stuck

## Red Flags

**Never:**
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:**
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

See template at: requesting-code-review/code-reviewer.md
