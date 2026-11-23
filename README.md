# 🤝 SideTeam

![Status](https://img.shields.io/badge/Status-Early%20development-orange)
![Language](https://img.shields.io/badge/Language-TypeScript-1d50de)
![License](https://img.shields.io/badge/License-MIT-2ea44f)

<br/>

**Delegate the work. Save tokens.**

SideTeam is a Claude Code plugin that gives Claude a team of execution engines of your choice: Codex CLI, OpenCode, Gemini CLI, or local models through Ollama. Claude keeps the planning and the judgment; the engine does the hands-on work in an isolated worktree, the project's own tests check the result, and Claude only reads a compact summary.

<br/>

## 📋 Summary

* **[📋 Summary](#-summary)**
* **[✨ Planned features](#-planned-features)**
* **[🚧 Status](#-status)**
* **[📄 License](#-license)**

<br/>

## ✨ Planned features

* 🔌 Pluggable engines: Codex CLI, OpenCode, Gemini CLI, Ollama, and any OpenAI-compatible endpoint
* 🧪 Machine-checked results: the project's tests run after every delegated task
* 🪜 Escalation: a task that fails moves up to a stronger engine, then back to Claude
* 🌳 Isolation: each task runs in its own git worktree
* 📊 Savings report: success rate per engine and tokens kept off Claude

<br/>

## 🚧 Status

SideTeam is in early development. Nothing is released yet; installation instructions will come with the first version.

<br/>

## 📄 License

SideTeam is released under the [MIT License](LICENSE).
