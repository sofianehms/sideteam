export type Options = { verbose: boolean; output: string | undefined; files: string[] };

export function parseOptions(args: readonly string[]): Options {
  const result: Options = { verbose: false, output: undefined, files: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      result.files.push(...args.slice(index + 1));
      break;
    }
    if (arg === "-v" || arg === "--verbose") {
      result.verbose = true;
    } else if (arg === "-o" || arg === "--output") {
      const value = args[++index];
      if (!value || (value !== "-" && value.startsWith("-"))) {
        throw new RangeError("Missing output path");
      }
      result.output = value;
    } else if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length);
      if (!value) throw new RangeError("Missing output path");
      result.output = value;
    } else if (arg !== "-" && arg.startsWith("-")) {
      throw new RangeError(`Unsupported option ${arg}`);
    } else {
      result.files.push(arg);
    }
  }
  return result;
}
