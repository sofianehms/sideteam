export type Options = { verbose: boolean; output: string | undefined; files: string[] };

export function parseOptions(args: readonly string[]): Options {
  return { verbose: false, output: undefined, files: [...args] };
}
