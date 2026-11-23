import type { Config } from "./config.js";

export type DelegationStatus = "success" | "check_failed" | "engine_failed" | "timeout";

export interface ChangedFile {
  path: string;
  added: number;
  deleted: number;
}

export interface DelegationOutcome {
  id: string;
  status: DelegationStatus;
  engine: string;
  model?: string | null;
  durationMs: number;
  reason?: string | null;
  files: readonly ChangedFile[];
  check?: { command: NonNullable<Config["check"]>; code: number | null; tail: readonly string[] };
  engineMessage?: string;
  base: string;
  diff: string;
  logPath: string;
}

type SummaryLimits = Pick<Config["limits"], "diffLines" | "checkLines" | "maxSummaryChars">;

interface RenderedSummary {
  text: string;
  structured: Pick<
    DelegationOutcome,
    "id" | "status" | "engine" | "model" | "durationMs" | "reason" | "files" | "logPath"
  > & {
    omittedFiles: number;
    check?: NonNullable<DelegationOutcome["check"]>;
    engineMessage: string;
    diff: string;
    diffNote?: string;
    nextStep: string;
  };
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 0) return "";
  return `${text.slice(0, limit - 1)}…`;
}

/** Renders matching text and fields, or throws if the cap cannot fit the required fields. */
export function renderSummary(outcome: DelegationOutcome, limits: SummaryLimits): RenderedSummary {
  const { id, status, engine, model, durationMs, reason, check, base, logPath } = outcome;
  const nextStep = `${status === "success" ? "apply" : "discard"} ${id}`;
  const required = [
    `SideTeam ${id}: ${status.toUpperCase()}`,
    `Next step: ${nextStep}`,
    `Raw log: ${logPath}`,
    `Engine: ${engine}${model ? ` | Model: ${model}` : ""} | Duration: ${durationMs} ms`,
    ...(reason ? [`Reason: ${reason}`] : []),
    "Files:",
  ];
  const checkLabel = check
    ? `Check: ${typeof check.command === "string" ? check.command : JSON.stringify(check.command)} (code: ${check.code ?? "unavailable"})`
    : undefined;
  const diff = outcome.diff ? outcome.diff.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const tail = check?.tail ?? [];
  const cap = Math.floor(limits.maxSummaryChars);
  let fileCount = Math.min(outcome.files.length, 50);
  const fileLines = outcome.files
    .slice(0, fileCount)
    .map(({ path, added, deleted }) => `${path} +${added} -${deleted}`);
  let engineMessage = truncate(outcome.engineMessage ?? "", 1500);
  let diffCount = Math.min(diff.length, Math.max(0, Math.floor(limits.diffLines)));
  let checkCount = Math.min(tail.length, Math.max(0, Math.floor(limits.checkLines)));

  function render() {
    const omittedFiles = outcome.files.length - fileCount;
    const checkLines = checkCount ? tail.slice(-checkCount) : [];
    const diffLines = diff.slice(0, diffCount);
    const diffNote =
      diffCount < diff.length
        ? `[diff truncated: ${diffCount} of ${diff.length} lines; full diff: git diff ${base}..sideteam/${id}]`
        : undefined;
    const text = [
      ...required,
      ...fileLines.slice(0, fileCount),
      ...(omittedFiles ? [`… and ${omittedFiles} more`] : []),
      ...(checkLabel ? [checkLabel] : []),
      ...(engineMessage ? [`Engine message: ${engineMessage}`] : []),
      ...(checkCount ? ["Check output:", ...checkLines] : []),
      ...(diffCount ? ["Diff:", ...diffLines] : []),
      ...(diffNote ? [diffNote] : []),
    ].join("\n");
    return { text, omittedFiles, checkLines, diffLines, diffNote };
  }

  if (!Number.isFinite(cap) || cap <= 0) {
    throw new RangeError("maxSummaryChars must be a finite positive character budget");
  }

  let rendered = render();
  let minDiffCount = 0;
  if (rendered.text.length > cap && diffCount === diff.length && diffCount > 0) {
    // Keep a short full diff when its truncation note would take at least as much space.
    diffCount = 0;
    if (render().text.length >= rendered.text.length) minDiffCount = diff.length;
    diffCount = diff.length;
  }
  while (
    rendered.text.length > cap &&
    (diffCount > minDiffCount || checkCount || fileCount || engineMessage)
  ) {
    if (diffCount > minDiffCount) diffCount--;
    else if (checkCount > 0) checkCount--;
    else if (fileCount > 0) fileCount--;
    else {
      const remaining = engineMessage.length - (rendered.text.length - cap);
      engineMessage = truncate(engineMessage, remaining);
    }
    rendered = render();
  }

  if (rendered.text.length > cap) {
    throw new RangeError(`maxSummaryChars (${cap}) is too small for the required summary fields`);
  }

  return {
    text: rendered.text,
    structured: {
      id,
      status,
      engine,
      model,
      durationMs,
      reason,
      files: outcome.files.slice(0, fileCount),
      omittedFiles: rendered.omittedFiles,
      check: check && { command: check.command, code: check.code, tail: rendered.checkLines },
      engineMessage,
      diff: rendered.diffLines.join("\n"),
      diffNote: rendered.diffNote,
      nextStep,
      logPath,
    },
  };
}
