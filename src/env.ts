const base = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
];

const windows = [
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "ProgramFiles",
];

export function buildEngineEnv(
  pass: string[],
  source = process.env,
  platform = process.platform,
): Record<string, string> {
  const normalize = (name: string) => (platform === "win32" ? name.toUpperCase() : name);
  const allowed = new Set(
    [...base, ...(platform === "win32" ? windows : []), ...pass].map(normalize),
  );
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(source)) {
    const key = normalize(name);
    if (value !== undefined && key !== "NO_COLOR" && allowed.has(key)) {
      entries.push([name, value]);
    }
  }
  return Object.fromEntries([...entries, ["NO_COLOR", "1"]]);
}
