export type TaskArgs = {
  command: string;
  rest: string[];
  dir: string;
  port: number;
  help: boolean;
  body?: string;
  status?: string;
  assignee?: string;
};

const take = (args: string[], i: number, flag: string): string => {
  const value = args[i];
  if (value === undefined || (value.startsWith("-") && value !== "-")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
};

export const parseArgs = (argv: string[]): TaskArgs => {
  const parsed: TaskArgs = {
    command: "",
    rest: [],
    dir: Deno.env.get("TASK_DIR") ?? "./tasks",
    port: 8788,
    help: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dir") parsed.dir = take(argv, ++i, "--dir");
    else if (arg === "--port") parsed.port = Number(take(argv, ++i, "--port"));
    else if (arg === "--body") parsed.body = take(argv, ++i, "--body");
    else if (arg === "--status") parsed.status = take(argv, ++i, "--status");
    else if (arg === "--assignee") parsed.assignee = take(argv, ++i, "--assignee");
    else if (arg === "--") continue;
    else if (arg === "--serve") rest.push("serve");
    else if (!arg.startsWith("-") || arg === "-") rest.push(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  parsed.command = rest[0] ?? "";
  parsed.rest = rest.slice(1);
  return parsed;
};
