---
description: Detect available engines and guide the user through configuring sideteam.
---

1. Call the sideteam `engines` tool with `{"detect": true}`. Show the detected engines and the proposed JSON configuration, including the default engine and any suggested project check. If no engines are found, explain the result and stop without writing a file.
2. Ask the user to choose a scope. For global scope, use `~/.config/sideteam/config.json` by default or `$XDG_CONFIG_HOME/sideteam/config.json` when set. On Windows, use `%APPDATA%/sideteam/config.json` or `~/AppData/Roaming/sideteam/config.json` when `APPDATA` is unset. For project scope, use `.sideteam.json` at the repository root, or in the current directory if outside a repository. Keep the detected project check in project scope only.
3. Resolve and show the destination path. Read any existing configuration there and preserve unrelated settings when preparing the proposed update. Show the diff and get explicit user confirmation before overwriting an existing file. If the destination changes after review, show the updated diff and ask for confirmation again.
4. Write the JSON configuration to the chosen path, creating its parent directory if needed. Call `engines` again with `{}` to verify the effective configuration and report the configuration files read, engine statuses, and any errors.
