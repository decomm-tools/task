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
 * Read one of this package's files next to `init.ts`. Works from a local
 * checkout (`file:`) and from JSR or any other `http(s):` URL, where there is no
 * directory on disk to read from.
 */
const readSource = async (name: string): Promise<Uint8Array> => {
  const url = new URL(name, import.meta.url);
  if (url.protocol === "file:") return await Deno.readFile(url);
  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Could not fetch ${url.href}: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error(`init cannot read its files from a ${url.protocol} URL`);
};

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
  // Read everything before touching the destination, so a failed fetch writes nothing.
  const sources = await Promise.all(
    FILES.map(async (name) => [name, await readSource(name)] as const),
  );

  await Deno.mkdir(root, { recursive: true });
  const existing = [...Deno.readDirSync(root)];
  if (existing.length > 0 && !options.force) {
    if (!Deno.stdin.isTerminal()) {
      throw new Error("Directory is not empty. Re-run with --force.");
    }
    const ok = confirm("Directory is not empty. Continue?");
    if (!ok) throw new Error("Directory is not empty, aborting.");
  }

  for (const [name, bytes] of sources) {
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
