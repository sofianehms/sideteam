# ⏱️ SideTeam Benchmark

![Language](https://img.shields.io/badge/Language-TypeScript-1d50de)
![CI](https://img.shields.io/badge/CI-GitHub%20Actions-fa8925)

<br/>

Compare the same coding tasks with Claude Code alone and with SideTeam delegation. Each trial starts from a fresh copy, and the hidden checks determine the outcome.

<br/>

## 📋 Summary

* **[✨ Features](#-features)**
* **[🛠️ Install](#️-install)**
* **[🚀 Run](#-run)**
* **[🧪 Develop](#-develop)**

<br/>

## ✨ Features

* 🧪 Compare a baseline arm with one arm per available engine.
* 💾 Record finished trials as they complete and resume after a quota stop or interruption.
* 📊 Generate Markdown and JSON summaries of success rates, token usage, duration, and cost.

<br/>

## 🛠️ Install

Use the repository's installed npm dependencies, Node.js 22.18 or later for the TypeScript tasks, Python 3 for the Python tasks, and Git on your path. Sign in to Claude Code and any subscription-based engine you plan to use. For the local engine, have OpenCode and a running Ollama instance with the configured model installed.

The engine configurations live in `bench/engines.json`. Change the local model there if your Ollama installation uses a different one.

<br/>

## 🚀 Run

Run the `bench` npm script from the repository root. Pass script arguments after npm's `--` separator.

| Option | Effect |
| --- | --- |
| `--series light\|full` | Light is the default. It selects tasks marked light, runs one repetition, and requests `codex` and `local`. Full selects all tasks, runs three repetitions, and requests all configured engines. |
| `--engines <list>` | Replace the requested engines with a comma-separated list. The runner prints a skip message for each unavailable engine and continues. |
| `--reps <n>` | Override the repetitions per task and arm. |
| `--trial-timeout <min>` | Set the time allowed for the session and hidden check. The default is 20 minutes, and a timeout counts as a failure. |
| `--out <directory>` | Write to this directory. The default is `bench/results/<series>/`. Use a fresh directory for a different experiment. |

A complete task set has six light tasks and twelve tasks overall. With the default engines available, light schedules 18 trials and full schedules 144. Arm A uses Claude Code alone. Arm B also loads a clean copy of the SideTeam plugin and permits delegation to the assigned engine. Both arms use `bypassPermissions` inside temporary task copies. This mode skips approval prompts, so use it only with trusted tasks and plugins.

Claude Code trials consume quota on a connected subscription without a separate per-trial bill. If a quota error stops the run with exit code 75, rerun the same command against the same output directory once capacity returns. Finished trials are read from `trials.jsonl` and skipped. Ctrl+C leaves the current trial pending for the next invocation.

Generate `results.md` and `results.json` for the default light directory.

```console
$ npm run bench -- report
```

Pass `--out` to the report command for a full series or a different directory. Coverage uses the saved trial plan when available and marks an incomplete run as partial. Trials of a requested engine that was skipped as unavailable stay in the plan, so a run without it is reported as partial. Each table row covers one difficulty level and one arm or engine. The main Claude token median includes input, output, and cache creation. Cache reads have their own column. Savings are calculated as one minus the delegated median divided by the baseline median for that level. Token medians use trials with recorded usage.

Costs are API-equivalent estimates. Cost per successful task divides the sum of measured Claude and engine costs across all trials in the row by the number of successes. Set an engine's optional `pricePerMTok` input and output rates in USD to estimate its cost. For unpriced engines, the report displays `engine cost n/a` and includes the measured engine tokens.

<br/>

## 🧪 Develop

The benchmark tests use temporary repositories and dummy JavaScript tasks. They run on Node.js 20 and 22 without accounts or installed engines.

```console
$ npx vitest run tests/bench/
$ npm run lint
```
