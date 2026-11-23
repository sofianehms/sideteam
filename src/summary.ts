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

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 0) return "";
  return `${text.slice(0, limit - 1)}…`;
}

export function renderSummary(outcome: DelegationOutcome, limits: SummaryLimits) {
  const { id, status, engine, model, durationMs, reason, check, base, logPath } = outcome;
  const files = outcome.files.slice(0, 50);
  const omittedFiles = outcome.files.length - files.length;
  const engineMessage = truncate(outcome.engineMessage ?? "", 1500);
  const nextStep = `${status === "success" ? "apply" : "discard"} ${id}`;
  const header = `SideTeam ${id}: ${status.toUpperCase()}`;
  const actions = `Next step: ${nextStep}\nRaw log: ${logPath}`;
  const details = [
    `Engine: ${engine}${model ? ` | Model: ${model}` : ""} | Duration: ${durationMs} ms`,
    ...(reason ? [`Reason: ${reason}`] : []),
    "Files:",
    ...files.map(({ path, added, deleted }) => `${path} +${added} -${deleted}`),
    ...(omittedFiles ? [`… and ${omittedFiles} more`] : []),
    ...(check
      ? [
          `Check: ${typeof check.command === "string" ? check.command : JSON.stringify(check.command)} (code: ${check.code ?? "unavailable"})`,
        ]
      : []),
    ...(engineMessage ? [`Engine message: ${engineMessage}`] : []),
  ].join("\n");

  const diff = outcome.diff ? outcome.diff.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const tail = check?.tail ?? [];
  const cap = Math.max(0, Math.floor(limits.maxSummaryChars));
  let diffCount = Math.min(diff.length, Math.max(0, Math.floor(limits.diffLines)));
  let checkCount = Math.min(tail.length, Math.max(0, Math.floor(limits.checkLines)));

  function diffNote() {
    return diffCount < diff.length
      ? `[diff truncated: ${diffCount} of ${diff.length} lines; full diff: git diff ${base}..sideteam/${id}]`
      : undefined;
  }

  function output() {
    return [
      ...(checkCount ? ["Check output:", ...tail.slice(-checkCount)] : []),
      ...(diffCount ? ["Diff:", ...diff.slice(0, diffCount)] : []),
      ...(diffNote() ? [diffNote()] : []),
    ].join("\n");
  }

  let excerpt = output();
  while (excerpt && header.length + actions.length + details.length + excerpt.length + 3 > cap) {
    if (diffCount > 0) diffCount--;
    else if (checkCount > 0) checkCount--;
    else break;
    excerpt = output();
  }

  const required = `${header}\n${actions}`;
  const body = excerpt ? `${details}\n${excerpt}` : details;
  const text =
    required.length >= cap
      ? truncate(required, cap)
      : [required, truncate(body, cap - required.length - 1)].filter(Boolean).join("\n");

  return {
    text,
    structured: {
      id,
      status,
      engine,
      model,
      durationMs,
      reason,
      files,
      omittedFiles,
      check: check && { ...check, tail: checkCount ? tail.slice(-checkCount) : [] },
      engineMessage,
      diff: diff.slice(0, diffCount).join("\n"),
      diffNote: diffNote(),
      nextStep,
      logPath,
    },
  };
}
