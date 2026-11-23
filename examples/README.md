# 🧰 SideTeam configuration examples

![Language](https://img.shields.io/badge/Language-JSON-1d50de)
![CI](https://img.shields.io/badge/CI-GitHub%20Actions-fa8925)

<br/>

Use these presets to delegate work to a local Ollama model.

<br/>

## 📋 Summary

* [📋 Summary](#-summary)
* [✨ Features](#-features)
* [🛠️ Install](#️-install)
* [🚀 Run](#-run)
* [🧪 Develop](#-develop)

<br/>

## ✨ Features

* [Ollama via OpenCode](config/ollama-opencode.json) selects `ollama/qwen3-coder:30b` using the `ollama` provider.
* [Ollama via Codex](config/codex-oss.json) enables OSS mode with Ollama as the local provider.

<br/>

## 🛠️ Install

Install and start Ollama, then install OpenCode or Codex for your selected preset. Aim for 16–24 GB of graphics memory and choose a quantization that leaves room for the context window. The Qwen3-Coder and Devstral Small families are starting points.

Download a model through Ollama, for example by pulling `qwen3-coder:30b` with its pull subcommand. Set the serving context to at least 64k tokens (65,536 with `OLLAMA_CONTEXT_LENGTH` on the Ollama server) and keep the client context limit consistent with it.

For OpenCode, register a provider named `ollama` and declare the downloaded tag under that provider. Follow the [Ollama integration guide](https://docs.ollama.com/integrations/opencode) for the provider endpoint and configuration format. For Codex, use its local model selection or add the chosen tag as the preset's `model` value.

<br/>

## 🚀 Run

Copy the chosen JSON preset to `.sideteam.json` in the repository root. If that file already exists, merge in the `local` engine entry. Configure the project's verification command under `check` and select the `local` engine when delegating.

The OpenCode adapter passes the prompt as a process argument. It can be visible in the process list and is limited to 30,000 characters.

<br/>

## 🧪 Develop

Validate every preset against the runtime configuration schema from the repository root.

```console
$ npx vitest run tests/examples.test.ts
```
