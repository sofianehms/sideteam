---
name: delegate
description: Delegate a small, well-specified repository change, verify it with the project's check command, and review the diff before applying it.
---

# Delegate a change

## When to delegate

Use `delegate` for one modest change with a clear specification, a few identified files, and a project check command that can verify the result.

## When to keep the work

Handle design and architecture, ambiguous requirements, security-sensitive code, and cross-cutting refactors directly. Keep the work if there is no suitable check command or the task requires secrets or network access.

## Choose an engine

Call `engines` on first use to see which engines are configured and available. Choose an engine with `privacy: "local"` for confidential code. If the available engines cannot meet the project's privacy requirements, handle the task directly.

## Write the prompt

Fill in [prompt-template.md](prompt-template.md) for a single task. State the objective in one sentence. Give the exact paths to modify, signatures, constraints, check command, and prohibitions. Pass the completed template as the `prompt`, the context paths as `files`, and the same command as `check` when calling `delegate`. Pass the selected engine name as `engine` on every `delegate` call, including retries. Omitting `engine` uses the configured default, which may be a cloud engine.

## Review the summary

Use the run ID to identify the result. Inspect the changed files, check result, and diff. If the summary truncates the diff, use the full-diff command in the truncation note.

Read the diff before calling apply. Call `apply` with the run ID only after confirming that the full diff satisfies the task and the check passed. Never apply unreviewed work.

- `success` means the change passed the check. Apply it after review or call `discard` if it fails review.
- `check_failed` means the check did not pass. Read the check output, discard the failed run, then delegate again with the relevant error excerpt or take over the task.
- `engine_failed` means the run could not produce a change ready for checking. Call `discard` with the run ID, then use the reported reason to decide whether to retry or take over.
- `timeout` means the engine exceeded its time limit. Call `discard` with the run ID, then decide whether to retry a smaller task or take over.
