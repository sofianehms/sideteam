# 🤝 SideTeam

![Release](https://img.shields.io/badge/Release-v0.2.0-blueviolet)
![Language](https://img.shields.io/badge/Language-TypeScript-1d50de)
![Dependencies](https://img.shields.io/badge/Dependencies-none-2ea44f)
![CI](https://img.shields.io/badge/CI-GitHub%20Actions-fa8925)

<br/>

**Delegate the work. Save tokens.**

SideTeam is a Claude Code plugin for delegating small coding tasks to a configured engine. It runs the task in a separate Git worktree, checks the result with your project’s own command, and returns a compact summary for review. The dependency badge refers to npm packages needed after installing the bundled plugin.

> Delegate adding a missing-input test to the validation suite. Use the project’s configured check and show me the diff before applying it.

<br/>

## 📋 Summary

* **[📋 Summary](#-summary)**
* **[✨ Features](#-features)**
* **[🛠️ Install](#️-install)**
* **[🚀 Run](#-run)**
* **[⚙️ Configuration](#️-configuration)**
* **[🔌 Engines](#-engines)**
* **[📊 Benchmark](#-benchmark)**
* **[🔒 Security](#-security)**
* **[🧪 Develop](#-develop)**
* **[🤝 Contribute](#-contribute)**
* **[📄 License](#-license)**

<br/>

## ✨ Features

* 🌳 Run each task on its own branch and worktree, starting from the current commit.
* 🧪 Run the project’s verification command and report its outcome with the diff.
* 🔍 Review the full change before choosing whether to merge or discard it.
* 🔌 Choose a cloud engine or configure a local Ollama backend.
* 📊 Track delegation outcomes, durations, and reported tokens by engine.
* 📦 Run the bundled server with Node.js without installing npm dependencies in the plugin directory.

<br/>

## 🛠️ Install

Install Claude Code, Git, and Node.js 20 or later. Install the engines you want to use and complete their authentication or local provider setup yourself. The marketplace install needs access to the GitHub repository.

Run these commands in Claude Code.

```text
/plugin marketplace add sofianehms/sideteam
/plugin install sideteam@sideteam
/sideteam:setup
```

Setup detects available engines and proposes a configuration. Choose global or project scope, review the proposal, and confirm any overwrite. As an installation check, verify that the final engine table lists the expected engine as installed and shows the configuration file you chose. An installed executable can still require authentication.

<br/>

## 🚀 Run

Open Claude Code in a Git repository with at least one commit. Ask it to delegate one well-scoped change and specify the files and verification command. Commit any in-progress changes that the engine needs to see. If the summary truncates the diff, use the full-diff command it provides. Review the full diff and check result before asking Claude Code to apply a successful run or discard it. Start from a clean working tree when applying a run.

| Tool | Parameters and result |
| --- | --- |
| `engines` | Optional boolean `detect` defaults to false. Lists configured engines, executable status, and configuration sources. A generic engine may show `unknown` until it is run. With `detect: true`, returns a JSON proposal and a suggested check when available. |
| `delegate` | Required nonempty `prompt`. Optional `engine` names a configured entry. Optional `files` is a list of repository-relative paths to include as context. Optional string `check` overrides the project verification command for this run. Optional `timeoutMinutes` is greater than zero and at most 240. Optional boolean `fallback` defaults to true. Returns a run ID, status, and compact summary with changed files, check output, and diff when available. |
| `apply` | Required nonempty run `id`. Merges the delegation branch into the current branch and removes its worktree on success. A merge refusal leaves the run available for inspection. The tool treats approval as the caller’s responsibility, so only apply after review and a passing check. |
| `discard` | Required nonempty run `id`. Removes the delegation worktree and branch without merging. |
| `stats` | Optional positive `sinceDays` defaults to 30. Optional `repo` defaults to `"current"`. Use `"all"` for every repository in the active journal. Returns outcomes, success rate, median duration, reported tokens, applications, and estimated Claude token savings with measurement coverage. |

| Status | Meaning |
| --- | --- |
| `success` | The engine produced changes and the project check passed. Review before applying. |
| `check_failed` | The last check failed. Inspect its output before discarding the run. |
| `engine_failed` | The engine or setup failed, or the run produced no changes to check. Inspect the reason before discarding. |
| `timeout` | The last engine or check exceeded its time limit. |

Run `/sideteam:stats` in Claude Code to see the statistics. SideTeam stores events in `<dataDir>/journal.jsonl` and reports the number of malformed lines it skipped. Each completed delegation is counted once under its final engine. The duration includes retries and fallbacks, and tokens come from the final attempt. Applications count selected delegations applied within the same time window.

**Token savings.** SideTeam subtracts the Claude output used to call the delegation tools and the input added by each delegation summary from the engine's reported output tokens. It estimates the summary input from the change in input usage including cache tokens, or rounds up one token per four characters when that change is unavailable or shared with other input. Engine input is informational. The table shows measured runs out of all selected runs and requires a matching transcript and reported engine output. Estimates can be negative and use engine output as a proxy for work avoided. SideTeam reads local transcripts without storing or returning their contents.

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

A failed check triggers a retry in the same worktree with the original prompt and the tail of the check output. An engine failure or timeout advances directly to the next engine. Each fallback engine starts in a fresh worktree from the original base revision. Pass `fallback: false` to `delegate` to use only the selected engine. Its retry budget still applies.

The summary lists the attempts in order. The full attempt history is in `runs/<id>/meta.json` under `dataDir`, with prompts and logs in `runs/<id>/attempt-<k>/` numbered across the whole run.

Commands in `check` and `worktree.setup` run as a single executable without a shell. Put multi-step commands in a project script.

| Field under `engines.<name>` | Meaning |
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

## 📊 Benchmark

The light series ran on 2026-11-23 with a separate benchmark runner. Arm A is Claude Code alone. Arm B is Claude Code with SideTeam loaded and permission to delegate to Codex.

* 📅 Date: 2026-11-23T08:49:33.547Z (report generation).
* 🧩 Coverage: 12/18 trials (partial). The `local` engine (OpenCode with Ollama) was not installed on the benchmark machine, so its 6 trials were skipped. Gemini is not part of the light series.
* 🏷️ Versions: Claude Code 2.1.330 with `claude-sonnet-5-5`, Codex CLI 0.169.0. No Codex model was recorded because no trial delegated.
* 🔁 Trials: six light tasks (three TypeScript, three Python; two per difficulty), one repetition per arm, 20-minute limit, Node.js 22.23.5 and Python 3.

| Level | Arm | Engine | Success rate | Median Claude tokens | Median cache read | Savings (1 − B/A) | Median engine tokens | Median duration (s) | Cost per successful task (USD) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| easy | A | — | 50.0% | 14289 | 65914.5 | n/a | n/a | 6.644 | $0.134427 |
| easy | B | codex | 50.0% | 14320 | 54962.5 | -0.2% | 0 | 7.080 | engine cost n/a |
| medium | A | — | 100.0% | 15083.5 | 66153.5 | n/a | n/a | 10.252 | $0.073166 |
| medium | B | codex | 100.0% | 15416 | 66677.5 | -2.2% | 0 | 10.791 | engine cost n/a |
| hard | A | — | 100.0% | 17140 | 66196.5 | n/a | n/a | 13.873 | $0.086059 |
| hard | B | codex | 100.0% | 18307.5 | 90590.5 | -6.8% | 0 | 17.021 | engine cost n/a |

What these figures show:

* ⚠️ SideTeam saved nothing in this series. Savings are negative at every level (-0.2%, -2.2%, -6.8%), and arm B was slower at every level. Claude never called the `delegate` tool in any arm B trial, although the plugin and its tools were loaded. The extra cost is the plugin's tool definitions and instructions, with no delegated work to offset it.
* ❌ Success rates are equal in both arms. The single failure per arm is `01-ts-slugify`: both arms lowercased before removing non-ASCII characters, so the hidden check on the Kelvin sign (U+212A) failed. No trial timed out, and no failure came from an engine.

Limits:

* 📏 The sample is small: two trials per row and one repetition. These figures do not support a general conclusion.
* 💵 Claude costs are API-equivalent estimates from Claude Code. The runs used a flat-rate Claude subscription, so no per-trial amount was billed.
* ❔ Engine cost is unknown for subscriptions and local models. Codex ran on a ChatGPT subscription without a configured price, hence `engine cost n/a`.
* 🖥️ No local model was measured, so no Ollama hardware applies to these results.
* ⏳ The full series (144 planned trials) has started and resumes across sessions. Its partial state is not summarized here.

<br/>

## 🔒 Security

* Each delegation runs in a separate worktree. Linked dependencies can still point into the original checkout. Codex runs with its workspace-write sandbox by default. Engines without a sandbox retain the process user’s filesystem permissions.
* SideTeam passes engines a filtered environment with basic system variables and any names explicitly listed in `env`. Setup and verification commands inherit the server environment. Run trusted project scripts and pass only the variables an engine needs.
* Cloud providers can receive source code and prompts. Check their data handling and retention terms, especially on free tiers. Use a verified local configuration for confidential work. The `privacy` setting describes the provider and does not enforce network isolation.
* The OpenCode adapter sends the prompt on standard input. If you pass prompt text as an OpenCode argument yourself, it can be visible in the process list.
* SideTeam sends no telemetry. Run prompts and logs are stored locally under `dataDir`. The journal records summary metadata and excludes prompts, logs, and environment variables. Review engine and provider telemetry settings separately.
* On Windows, `.cmd` wrappers cannot be launched directly by the shell-free runner. Configure a native executable or use Node with the engine’s JavaScript entry point.

<br/>

## 🧪 Develop

Run these commands from the repository root with Node.js 20 or later.

```console
$ npm ci
$ npm test
$ npm run lint
$ npm run build
$ npm run check:dist
```

Tests use fake engines and temporary repositories. The suite requires at least 80% line, statement, and function coverage for core code. GitHub Actions tests Node.js 20 and 22 on Linux and macOS.

The marketplace runs the checked-in `dist/sideteam.js` directly. Rebuild it after changes that affect the bundle and force-add this file because `dist/` is ignored. The bundle check compares it byte-for-byte with a fresh build.

<br/>

## 🤝 Contribute

Open pull requests against `dev` and use Conventional Commits.

<br/>

## 📄 License

SideTeam is released under the [MIT License](LICENSE).
