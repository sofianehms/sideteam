# 📘 SideTeam reference

![Release](https://img.shields.io/badge/Release-v0.2.0-blueviolet)
![Language](https://img.shields.io/badge/Language-TypeScript-1d50de)

<br/>

Everything the [README](README.md) leaves out: tool parameters, run statuses, every configuration field, engine settings, the token savings method and the full security notes.

<br/>

## 📋 Summary

* **[🧰 Tools](#-tools)**
* **[🚦 Run statuses](#-run-statuses)**
* **[🔁 Retries and fallback](#-retries-and-fallback)**
* **[📊 Statistics and token savings](#-statistics-and-token-savings)**
* **[⚙️ Configuration](#️-configuration)**
* **[🔌 Engines](#-engines)**
* **[🔒 Security](#-security)**

<br/>

## 🧰 Tools

Open Claude Code in a Git repository with at least one commit. Commit any in-progress changes that the engine needs to see. If the summary truncates the diff, use the full-diff command it provides. Review the full diff and check result before asking Claude Code to apply a successful run or discard it. Start from a clean working tree when applying a run.

| Tool | Parameters and result |
| --- | --- |
| `engines` | Optional boolean `detect` defaults to false. Lists configured engines, executable status, and configuration sources. A generic engine may show `unknown` until it is run. With `detect: true`, returns a JSON proposal and a suggested check when available. |
| `delegate` | Required nonempty `prompt`. Optional `engine` names a configured entry. Optional `files` is a list of repository-relative paths to include as context. Optional string `check` overrides the project verification command for this run. Optional `timeoutMinutes` is greater than zero and at most 240. Optional boolean `fallback` defaults to true. Returns a run ID, status, and compact summary with changed files, check output, and diff when available. |
| `apply` | Required nonempty run `id`. Merges the delegation branch into the current branch and removes its worktree on success. A merge refusal leaves the run available for inspection. The tool treats approval as the caller’s responsibility, so only apply after review and a passing check. |
| `discard` | Required nonempty run `id`. Removes the delegation worktree and branch without merging. |
| `stats` | Optional positive `sinceDays` defaults to 30. Optional `repo` defaults to `"current"`. Use `"all"` for every repository in the active journal. Returns outcomes, success rate, median duration, reported tokens, applications, and estimated Claude token savings with measurement coverage. |

<br/>

## 🚦 Run statuses

| Status | Meaning |
| --- | --- |
| `success` | The engine produced changes and the project check passed. Review before applying. |
| `check_failed` | The last check failed. Inspect its output before discarding the run. |
| `engine_failed` | The engine or setup failed, or the run produced no changes to check. Inspect the reason before discarding. |
| `timeout` | The last engine or check exceeded its time limit. |

<br/>

## 🔁 Retries and fallback

A failed check triggers a retry in the same worktree with the original prompt and the tail of the check output. An engine failure or timeout advances directly to the next engine. Each fallback engine starts in a fresh worktree from the original base revision. Pass `fallback: false` to `delegate` to use only the selected engine. Its retry budget still applies.

The summary lists the attempts in order. The full attempt history is in `runs/<id>/meta.json` under `dataDir`, with prompts and logs in `runs/<id>/attempt-<k>/` numbered across the whole run.

<br/>

## 📊 Statistics and token savings

Run `/sideteam:stats` in Claude Code to see the statistics. SideTeam stores events in `<dataDir>/journal.jsonl` and reports the number of malformed lines it skipped. Each completed delegation is counted once under its final engine. The duration includes retries and fallbacks, and tokens come from the final attempt. Applications count selected delegations applied within the same time window.

SideTeam subtracts the Claude output used to call the delegation tools and the input added by each delegation summary from the engine's reported output tokens. It estimates the summary input from the change in input usage including cache tokens, or rounds up one token per four characters when that change is unavailable or shared with other input. Engine input is informational. The table shows measured runs out of all selected runs and requires a matching transcript and reported engine output. Estimates can be negative and use engine output as a proxy for work avoided. SideTeam reads local transcripts without storing or returning their contents.

<br/>

## ⚙️ Configuration

Set project options in `.sideteam.json` at the repository root. Global configuration lives at `$XDG_CONFIG_HOME/sideteam/config.json`, with a default of `~/.config/sideteam/config.json`. On Windows, use `%APPDATA%/sideteam/config.json`, with a default of `~/AppData/Roaming/sideteam/config.json`.

SideTeam reads global settings first. Project values override global values. The `engines`, `worktree`, `limits`, and `savings` objects merge one level deep. A project engine of the same name replaces the entire global entry. Arrays are replaced, including link lists. Unknown fields in the merged configuration are rejected.

| Field | Meaning |
| --- | --- |
| `default` | Name of the engine to use when a call omits `engine`. A sole configured engine is selected automatically. With several engines and no default, choose one explicitly. |
| `check` | Verification command, as a string or argument array. A call-level `check` takes precedence. A check is required for delegation. |
| `engines` | Map of user-defined engine names to the settings below. |
| `fallback` | Optional list of configured engine names to try in order after the selected engine. Each name is tried once in the chain, with its own retry budget. |
| `retries` | Number of extra attempts per engine after a failed check. Use an integer from 0 to 3. The default is 1. |
| `dataDir` | Storage for the journal, run metadata, prompts, and logs. Relative paths resolve against the configuration file that supplied the value. Defaults to `CLAUDE_PLUGIN_DATA` when set, then `$XDG_DATA_HOME/sideteam` (normally `~/.local/share/sideteam`) or `%LOCALAPPDATA%/sideteam` on Windows (normally `~/AppData/Local/sideteam`). Applying or discarding a run leaves these records in place. |
| `worktree` | Worktree preparation settings. |
| `worktree.link` | Existing repository-relative paths to link into the worktree. Absolute paths and parent segments are rejected. Defaults to `node_modules` and `.venv` when setup is absent, and to an empty list when setup is configured. An explicit empty list disables linking. |
| `worktree.setup` | Optional command string or argument array run in the new worktree before the engine. A failure skips that engine. |
| `limits` | Default timeouts and summary limits. |
| `limits.timeoutMinutes` | Engine timeout in minutes, default 20. Precedence is call `timeoutMinutes`, then engine `timeoutMinutes`, then this limit. |
| `limits.checkTimeoutMinutes` | Time limit in minutes for each setup or verification command, default 10. |
| `limits.diffLines` | Maximum diff lines in the summary, default 150. |
| `limits.checkLines` | Number of output lines retained from the end of the check, default 40. |
| `limits.maxSummaryChars` | Maximum summary length in characters, default 8,000. |
| `savings.enabled` | Read transcripts to estimate token savings. Defaults to `true`. Set to `false` to skip transcript reading. |
| `savings.transcriptsDir` | Local transcript projects directory. Defaults to `$CLAUDE_CONFIG_DIR/projects` if set, or `~/.claude/projects`. Relative overrides resolve from the configuration file that supplies the value. |

Commands in `check` and `worktree.setup` run as a single executable without a shell. Put multi-step commands in a project script.

### Engine fields

| Field under`engines.<name>` | Meaning |
| --- | --- |
| `adapter` | Required adapter name from the table below. |
| `model` | Optional engine selection. Required as `provider/model` for OpenCode and when a generic command uses `{model}`. |
| `bin` | Override the built-in executable using a program string or an array starting with the program and its leading arguments. Use `command` for the generic adapter. |
| `args` | Extra arguments for the built-in adapters. |
| `command` | Argument array required for the generic adapter. Place the executable first. Supports `{prompt_file}`, `{cwd}`, and `{model}` substitutions. |
| `options` | Adapter-specific string, number, or boolean values. Codex supports `oss: true` and `localProvider` in OSS mode. |
| `env` | Additional inherited environment variable names. Values come from the process environment. |
| `privacy` | `local` or `cloud` (default). Describes where processing happens. Set it to reflect the actual provider. |
| `timeoutMinutes` | Positive per-engine timeout in minutes. A call override takes precedence. |

<br/>

## 🔌 Engines

| Engine | Adapter | Configuration |
| --- | --- | --- |
| Codex CLI | `codex` | Uses the `codex` executable by default. Supports the workspace-write sandbox and optional OSS mode. |
| OpenCode | `opencode` | Uses the `opencode` executable by default. Set `model` to a provider-qualified name. |
| Gemini CLI | `gemini` | Uses the `gemini` executable by default. For API-key authentication, allow the relevant variable in `env`. Not yet verified in real conditions. |
| Custom executable | `generic` | Set `command` to an executable and its arguments. Generic engines are configured manually. |

For local Ollama use, see the [Ollama presets and setup notes](examples/README.md).

<br/>

## 🔒 Security

* Each delegation runs in a separate worktree. Linked dependencies can still point into the original checkout. Codex runs with its workspace-write sandbox by default. Engines without a sandbox retain the process user’s filesystem permissions.
* SideTeam passes engines a filtered environment with basic system variables and any names explicitly listed in `env`. Setup and verification commands inherit the server environment. Run trusted project scripts and pass only the variables an engine needs.
* Cloud providers can receive source code and prompts. Check their data handling and retention terms, especially on free tiers. Use a verified local configuration for confidential work. The `privacy` setting describes the provider and does not enforce network isolation.
* The OpenCode adapter sends the prompt on standard input. If you pass prompt text as an OpenCode argument yourself, it can be visible in the process list.
* SideTeam sends no telemetry. Run prompts and logs are stored locally under `dataDir`. The journal records summary metadata and excludes prompts, logs, and environment variables. Review engine and provider telemetry settings separately.
* On Windows, `.cmd` wrappers cannot be launched directly by the shell-free runner. Configure a native executable or use Node with the engine’s JavaScript entry point.
