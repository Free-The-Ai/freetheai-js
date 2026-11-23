/**
 * The `freetheai` command.
 *
 *   npx freetheai init                    pick a tool and set it up
 *   npx freetheai init claude-code --model kimi-k3
 *   npx freetheai init codex --remove
 *   npx freetheai whoami                  the key's balance and limits
 *
 * The key comes from --key, FTAI_KEY, or a hidden prompt. It is checked with
 * the API before any file changes, every file is backed up first, and only
 * FreeTheAI's own settings are written or removed.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { VERSION } from "../version.js";
import {
  API_BASE,
  DEFAULT_FAST_MODEL,
  DEFAULT_MODEL,
  editClaudeSettings,
  editCodexConfig,
  editShellProfile,
  validKey,
  validModelId,
} from "./setup.js";

const TOOLS = ["claude-code", "codex"] as const;
type Tool = (typeof TOOLS)[number];

interface Options {
  command: string;
  tool?: Tool;
  model: string;
  fastModel: string;
  remove: boolean;
  key?: string;
}

const HELP = `freetheai ${VERSION}

Usage:
  freetheai init [claude-code|codex] [--model ID] [--fast-model ID] [--key ftai_...] [--remove]
  freetheai whoami [--key ftai_...]

The key can also come from FTAI_KEY. Make one at https://freetheai.org/dashboard/api-keys
`;

/** A refusal the user should read as is. It unwinds to main's catch instead
 * of calling process.exit, which on Windows can crash while fetch closes its
 * connection. */
class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message);
}

function parse(argv: string[]): Options {
  const options: Options = {
    command: argv[0] ?? "help",
    model: DEFAULT_MODEL,
    fastModel: DEFAULT_FAST_MODEL,
    remove: false,
  };
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const value = () => {
      const next = argv[++index];
      if (!next) fail(`${arg} needs a value`);
      return next;
    };
    if (arg === "--model") options.model = value();
    else if (arg === "--fast-model") options.fastModel = value();
    else if (arg === "--key") options.key = value();
    else if (arg === "--remove") options.remove = true;
    else if ((TOOLS as readonly string[]).includes(arg)) options.tool = arg as Tool;
    else fail(`unknown argument: ${arg}`);
  }
  if (!validModelId(options.model) || !validModelId(options.fastModel)) {
    fail("model IDs may hold letters, digits, and . _ / : - only");
  }
  return options;
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const output = rl as unknown as { _writeToOutput?: (text: string) => void };
      output._writeToOutput = (text: string) => {
        if (text.includes(question)) process.stdout.write(text);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function readKey(options: Options): Promise<string> {
  let key = options.key ?? process.env.FTAI_KEY ?? "";
  if (!key) {
    if (!process.stdin.isTTY) fail("no terminal to ask for the key: pass --key or set FTAI_KEY");
    key = await ask("FreeTheAI API key (from freetheai.org/dashboard/api-keys): ", true);
  }
  if (!validKey(key)) fail("that is not a FreeTheAI key (they start with ftai_)");
  return key;
}

async function keyInfo(key: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/key`, { headers: { Authorization: `Bearer ${key}` } });
  } catch {
    fail("could not reach FreeTheAI. Check your connection and try again.");
  }
  if (response.status === 401 || response.status === 403) {
    fail("FreeTheAI did not accept that key. Make a new one at freetheai.org/dashboard/api-keys");
  }
  if (!response.ok) fail(`FreeTheAI answered ${response.status}. Try again in a minute.`);
  const body = (await response.json()) as { data?: Record<string, unknown> };
  return body.data ?? {};
}

function readText(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function backup(file: string): void {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const copy = `${file}.bak-${stamp}-${process.pid}`;
  copyFileSync(file, copy);
  process.stdout.write(`Saved a copy of ${file} to ${copy}\n`);
}

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.freetheai.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

async function pickTool(options: Options): Promise<Tool> {
  if (options.tool) return options.tool;
  if (!process.stdin.isTTY) fail("name the tool: freetheai init claude-code or freetheai init codex");
  const answer = await ask("Set up which tool? 1) Claude Code  2) Codex CLI [1]: ");
  return answer === "2" || answer.toLowerCase().startsWith("codex") ? "codex" : "claude-code";
}

async function initClaude(options: Options): Promise<void> {
  const file = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
  if (options.remove) {
    if (!existsSync(file)) return void process.stdout.write("Nothing to remove.\n");
    backup(file);
    writeText(file, editClaudeSettings(readText(file), null));
    process.stdout.write("FreeTheAI settings removed from Claude Code.\n");
    return;
  }
  const key = await readKey(options);
  await keyInfo(key);
  process.stdout.write("Key checked.\n");
  const next = editClaudeSettings(readText(file), {
    key,
    model: options.model,
    fastModel: options.fastModel,
  });
  backup(file);
  writeText(file, next);
  process.stdout.write(
    `\nClaude Code now uses FreeTheAI with ${options.model} (background tasks: ${options.fastModel}).\nStart it with: claude\nPaid models bill your wallet: freetheai.org/dashboard/wallet\n`,
  );
}

function shellProfile(): string {
  const shell = process.env.SHELL ?? "";
  if (shell.endsWith("zsh")) return join(homedir(), ".zshrc");
  if (shell.endsWith("bash")) return join(homedir(), ".bashrc");
  return join(homedir(), ".profile");
}

function saveKeyVariable(key: string | null): string {
  if (process.platform === "win32") {
    const script =
      key === null
        ? "[Environment]::SetEnvironmentVariable('FREETHEAI_API_KEY', $null, 'User')"
        : "[Environment]::SetEnvironmentVariable('FREETHEAI_API_KEY', $env:FTAI_SAVE_KEY, 'User')";
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      env: { ...process.env, FTAI_SAVE_KEY: key ?? "" },
      stdio: "ignore",
    });
    if (result.status !== 0) fail("could not save FREETHEAI_API_KEY as a user variable");
    return "the user variable FREETHEAI_API_KEY";
  }
  const profile = shellProfile();
  writeText(profile, editShellProfile(readText(profile), key));
  return `FREETHEAI_API_KEY in ${profile}`;
}

async function initCodex(options: Options): Promise<void> {
  const file = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml");
  if (options.remove) {
    if (existsSync(file)) {
      backup(file);
      writeText(file, editCodexConfig(readText(file), null));
    }
    saveKeyVariable(null);
    process.stdout.write(
      "FreeTheAI removed from Codex. Pick another model provider in config.toml before running codex.\n",
    );
    return;
  }
  const key = await readKey(options);
  await keyInfo(key);
  process.stdout.write("Key checked.\n");
  backup(file);
  writeText(file, editCodexConfig(readText(file), options.model));
  const saved = saveKeyVariable(key);
  process.stdout.write(
    `\nCodex now uses FreeTheAI with ${options.model}.\nYour key is saved as ${saved}. Open a new terminal, then run codex.\nPaid models bill your wallet: freetheai.org/dashboard/wallet\n`,
  );
}

async function whoami(options: Options): Promise<void> {
  const info = await keyInfo(await readKey(options));
  const line = (label: string, value: unknown) =>
    process.stdout.write(`${label.padEnd(12)}${value ?? "-"}\n`);
  line("Key", info.label || info.key_prefix);
  line("Balance", `$${info.balance}`);
  line("Spendable", `$${info.spendable}`);
  line("Key spent", `$${info.usage}${info.limit ? ` of $${info.limit}` : ""}`);
}

export async function main(argv: string[]): Promise<void> {
  const options = parse(argv);
  switch (options.command) {
    case "init": {
      const tool = await pickTool(options);
      if (tool === "codex") await initCodex(options);
      else await initClaude(options);
      return;
    }
    case "whoami":
      return whoami(options);
    case "--version":
    case "-v":
      process.stdout.write(`${VERSION}\n`);
      return;
    default:
      process.stdout.write(HELP);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
});
