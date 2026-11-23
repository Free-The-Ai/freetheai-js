/**
 * Pure setup edits behind `npx freetheai init`: they take a tool's current
 * settings text and return the new text, so they are tested without touching
 * any real file. Only FreeTheAI's own keys change; everything else stays.
 */

export const API_ROOT = "https://api.freetheai.org";
export const API_BASE = `${API_ROOT}/v1`;
export const DEFAULT_MODEL = "glm-5.3";
export const DEFAULT_FAST_MODEL = "glm-5.3-flash";

/** The environment keys `init claude-code` writes into settings.json. */
export const CLAUDE_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
] as const;

const MODEL_ID = /^[A-Za-z0-9._/:-]+$/;
const KEY_SHAPE = /^ftai_[A-Za-z0-9_-]+$/;

export function validModelId(model: string): boolean {
  return MODEL_ID.test(model);
}

export function validKey(key: string): boolean {
  return KEY_SHAPE.test(key);
}

export interface ClaudeChoice {
  key: string;
  model: string;
  fastModel: string;
}

/**
 * Adds (choice given) or removes (choice null) the FreeTheAI env keys in a
 * Claude Code settings.json text. An empty text is an empty file. Throws on
 * a file that is not a JSON object, so nothing is overwritten by mistake.
 */
export function editClaudeSettings(text: string, choice: ClaudeChoice | null): string {
  let settings: Record<string, unknown> = {};
  if (text.trim() !== "") {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("settings.json is not a JSON object");
    }
    settings = parsed as Record<string, unknown>;
  }
  const current = settings.env;
  const env: Record<string, unknown> =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  const values: Record<(typeof CLAUDE_KEYS)[number], string> | null = choice
    ? {
        ANTHROPIC_BASE_URL: API_ROOT,
        ANTHROPIC_AUTH_TOKEN: choice.key,
        ANTHROPIC_MODEL: choice.model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: choice.model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: choice.model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: choice.fastModel,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      }
    : null;
  for (const name of CLAUDE_KEYS) {
    if (values) env[name] = values[name];
    else delete env[name];
  }
  const { env: _previous, ...rest } = settings;
  const next: Record<string, unknown> = Object.keys(env).length > 0 ? { ...rest, env } : rest;
  return `${JSON.stringify(next, null, 2)}\n`;
}

const TABLE_HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;
const TOP_KEY = /^\s*(model|model_provider)\s*=/;

/**
 * Makes FreeTheAI Codex's model provider (model given) or takes it out
 * (model null) in a config.toml text. Only the top-level model and
 * model_provider keys and the [model_providers.freetheai] table change.
 */
export function editCodexConfig(text: string, model: string | null): string {
  const out: string[] = [];
  let table: string | null = null;
  let ours = false;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const header = TABLE_HEADER.exec(line);
    if (header) {
      table = header[1] ?? null;
      ours = table === "model_providers.freetheai";
      if (ours) continue;
    }
    if (ours) continue;
    if (table === null) {
      const key = TOP_KEY.exec(line);
      if (key && model !== null) continue;
      if (key && model === null && key[1] === "model_provider" && line.includes("freetheai")) continue;
    }
    out.push(line);
  }
  while (out.length > 0 && (out[out.length - 1] ?? "").trim() === "") out.pop();
  if (model !== null) {
    out.unshift(`model = "${model}"`, 'model_provider = "freetheai"');
    out.push(
      "",
      "[model_providers.freetheai]",
      'name = "FreeTheAI"',
      `base_url = "${API_BASE}"`,
      'env_key = "FREETHEAI_API_KEY"',
      'wire_api = "responses"',
    );
  }
  return `${out.join("\n")}\n`;
}

/** Sets (key given) or removes the FREETHEAI_API_KEY export in a shell profile. */
export function editShellProfile(text: string, key: string | null): string {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith("export FREETHEAI_API_KEY="));
  while (lines.length > 0 && (lines[lines.length - 1] ?? "") === "") lines.pop();
  if (key !== null) lines.push(`export FREETHEAI_API_KEY='${key}'`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
