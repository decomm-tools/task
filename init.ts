/**
 * Copy this package into a folder you can carry onto an isolated machine.
 *
 * Writes `main.ts`, the store, the UI, `task.sh`, and `deno.json`. On a
 * connected box run `deno task compile`, then copy the folder (including
 * `bin/task`) to the far side.
 *
 * @example
 * ```ts
 * import { init } from "jsr:@decomm/task/init";
 *
 * await init("./my-task");
 * ```
 *
 * @module
 */
const HELP = `decomm task

Copy this tool into a folder you can carry onto an isolated machine.

  deno run -A jsr:@decomm/task/init ./my-task
  cd my-task
  deno task compile
  ./task.sh --dir ./tasks init
`;

const join = (root: string, name: string): string => `${root}/${name}`;

const resolveDir = (directory: string): string => {
  if (directory.startsWith("/")) return directory;
  return `${Deno.cwd()}/${directory}`;
};

const FILES = [
  "main.ts",
  "args.ts",
  "store.ts",
  "ui.ts",
  "task.sh",
  "deno.json",
  "README.md",
  "LICENSE",
] as const;

/**
 * Write a self-contained task tree into `directory`.
 *
 * @param directory Destination folder (created if missing). Relative paths are
 * resolved from the current working directory.
 * @param options.force Overwrite when the folder already has files. Without
 * this, a TTY is prompted; a non-TTY run throws.
 */
export const init = async (
  directory: string,
  options: { force?: boolean } = {},
): Promise<void> => {
  const root = resolveDir(directory);
  const here = import.meta.dirname;
  if (!here) throw new Error("init needs a file path (not a blob URL)");

  await Deno.mkdir(root, { recursive: true });
  const existing = [...Deno.readDirSync(root)];
  if (existing.length > 0 && !options.force) {
    if (!Deno.stdin.isTerminal()) {
      throw new Error("Directory is not empty. Re-run with --force.");
    }
    const ok = confirm("Directory is not empty. Continue?");
    if (!ok) throw new Error("Directory is not empty, aborting.");
  }

  for (const name of FILES) {
    const bytes = await Deno.readFile(join(here, name));
    await Deno.writeFile(join(root, name), bytes);
  }
  await Deno.chmod(join(root, "task.sh"), 0o755);

  console.log(`Task copied to ${root}`);
  console.log("On a connected machine: deno task compile");
  console.log("Then: ./task.sh --dir ./tasks init");
};

if (import.meta.main) {
  const args = Deno.args;
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(HELP);
    Deno.exit(args.length === 0 ? 2 : 0);
  }
  const force = args.includes("--force") || args.includes("-f");
  const directory = args.find((arg) => !arg.startsWith("-"));
  if (!directory) {
    console.log(HELP);
    Deno.exit(2);
  }
  try {
    await init(directory, { force });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
