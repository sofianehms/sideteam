import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { finished } from "node:stream/promises";

export type Command = {
  bin: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
};

type RunOptions = {
  timeoutMs: number;
  logFile: string;
  onProgress?: (elapsedMs: number) => void;
  progressIntervalMs?: number;
  maxStdoutBytes?: number;
  signal?: AbortSignal;
};

const stderrLimit = 64 * 1024;

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function killWindowsTree(pid: number): Promise<boolean> {
  const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
    shell: false,
    windowsHide: true,
    stdio: "ignore",
  });
  return new Promise((resolve) => {
    killer.once("error", () => resolve(false));
    killer.once("close", (code) => resolve(code === 0));
  });
}

export async function run(
  cmd: Command,
  {
    timeoutMs,
    logFile,
    onProgress,
    progressIntervalMs = 30000,
    maxStdoutBytes = 10 * 1024 * 1024,
    signal,
  }: RunOptions,
) {
  await mkdir(dirname(logFile), { recursive: true });
  const file = await open(logFile, "w");
  const log = file.createWriteStream();
  const windows = process.platform === "win32";
  const started = performance.now();
  let timedOut = false;
  let spawnError: string | undefined;
  let stdoutBytes = 0;
  let stdoutTruncated = false;
  const stdout: Buffer[] = [];
  let stderr = Buffer.alloc(0);

  try {
    signal?.throwIfAborted();
    const child = spawn(cmd.bin, cmd.args, {
      cwd: cmd.cwd,
      env: cmd.env,
      shell: false,
      windowsHide: true,
      detached: !windows,
    });

    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("error", (error: NodeJS.ErrnoException) => {
          spawnError = error.code === "ENOENT" ? `not found: ${cmd.bin}` : error.message;
        });
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );

    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.stdout.on("data", (chunk: Buffer) => {
      const length = Math.min(chunk.length, Math.max(0, maxStdoutBytes - stdoutBytes));
      if (length) stdout.push(chunk.subarray(0, length));
      stdoutBytes += length;
      stdoutTruncated ||= length < chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr =
        chunk.length >= stderrLimit
          ? Buffer.from(chunk.subarray(-stderrLimit))
          : Buffer.concat([
              stderr.subarray(Math.max(0, stderr.length + chunk.length - stderrLimit)),
              chunk,
            ]);
    });

    let stop: Promise<void> | undefined;
    let cancelEscalation: (() => void) | undefined;
    const pid = child.pid;
    const stopTree = (force: boolean): Promise<void> => {
      if (pid === undefined) return Promise.resolve();
      if (windows)
        return killWindowsTree(pid).then((stopped) => {
          if (!stopped) child.kill();
        });
      if (force) {
        signalGroup(pid, "SIGKILL");
        return Promise.resolve();
      }
      if (!signalGroup(pid, "SIGTERM")) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          try {
            signalGroup(pid, "SIGKILL");
            resolve();
          } catch (error) {
            reject(error);
          }
        }, 5000);
        cancelEscalation = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    };

    const logged = finished(log);
    void logged.catch(() => {
      void stopTree(true).catch(() => child.kill());
    });
    child.stdin.on("error", () => {
      // A program can close stdin before consuming the supplied input.
    });
    child.stdin.end(cmd.stdin);

    let rejectTimeout: (reason: unknown) => void = () => {};
    const stopFailed = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      stop ??= Promise.resolve().then(() => stopTree(false));
      void stop.catch(rejectTimeout);
    }, timeoutMs);
    const abort = () => {
      stop ??= stopTree(true);
      void stop.catch(rejectTimeout);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const progress =
      onProgress && setInterval(() => onProgress(performance.now() - started), progressIntervalMs);

    try {
      const result = await Promise.race([closed, stopFailed]);
      clearTimeout(timeout);
      if (!windows && pid !== undefined && cancelEscalation && !signalGroup(pid, 0)) {
        cancelEscalation();
      }
      await stop;
      log.end();
      await logged;
      return {
        ...result,
        timedOut,
        durationMs: performance.now() - started,
        stdout: Buffer.concat(stdout).toString(),
        stderr: stderr.toString(),
        stdoutTruncated,
        ...(spawnError === undefined ? {} : { spawnError }),
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      clearInterval(progress || undefined);
      cancelEscalation?.();
    }
  } finally {
    log.destroy();
    await file.close();
  }
}
