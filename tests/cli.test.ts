import { describe, expect, it } from "vitest";
import {
  editClaudeSettings,
  editCodexConfig,
  editShellProfile,
  validKey,
  validModelId,
} from "../src/cli/setup.js";

const choice = { key: "ftai_test", model: "kimi-k3", fastModel: "glm-5.3-flash" };

describe("init claude-code", () => {
  it("adds FreeTheAI and keeps every other setting", () => {
    const next = JSON.parse(editClaudeSettings('{"theme":"dark","env":{"KEEP":"1"}}', choice));
    expect(next.theme).toBe("dark");
    expect(next.env.KEEP).toBe("1");
    expect(next.env.ANTHROPIC_BASE_URL).toBe("https://api.freetheai.org");
    expect(next.env.ANTHROPIC_AUTH_TOKEN).toBe("ftai_test");
    expect(next.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-5.3-flash");
  });

  it("removes exactly what it added", () => {
    const original = '{\n  "theme": "dark",\n  "env": {\n    "KEEP": "1"\n  }\n}\n';
    expect(editClaudeSettings(editClaudeSettings(original, choice), null)).toBe(original);
    expect(JSON.parse(editClaudeSettings(editClaudeSettings("", choice), null))).toEqual({});
  });

  it("refuses a file that is not a JSON object", () => {
    expect(() => editClaudeSettings("[1]", choice)).toThrow();
    expect(() => editClaudeSettings("{nope", choice)).toThrow();
  });
});

describe("init codex", () => {
  const config =
    'approval_policy = "on-request"\nmodel = "gpt-5"\n\n[profiles.fast]\nmodel = "o4-mini"\n\n[model_providers.freetheai]\nname = "old"\n\n[mcp_servers.docs]\ncommand = "npx"\n';

  it("sets the provider and keeps other tables", () => {
    const next = editCodexConfig(config, "kimi-k3");
    expect(
      next.startsWith('model = "kimi-k3"\nmodel_provider = "freetheai"\napproval_policy = "on-request"\n'),
    ).toBe(true);
    expect(next).toContain('[profiles.fast]\nmodel = "o4-mini"');
    expect(next).toContain("[mcp_servers.docs]");
    expect(next.match(/\[model_providers\.freetheai\]/g)).toHaveLength(1);
    expect(next).toContain('wire_api = "responses"');
    expect(next).not.toContain('name = "old"');
  });

  it("takes the provider out again", () => {
    const removed = editCodexConfig(editCodexConfig(config, "kimi-k3"), null);
    expect(removed).not.toContain("freetheai");
    expect(removed).toContain("[profiles.fast]");
  });

  it("writes one key export in a shell profile", () => {
    const once = editShellProfile("alias ll=ls\nexport FREETHEAI_API_KEY=old\n", "ftai_new");
    expect(once).toBe("alias ll=ls\nexport FREETHEAI_API_KEY='ftai_new'\n");
    expect(editShellProfile(once, null)).toBe("alias ll=ls\n");
  });
});

describe("inputs", () => {
  it("checks keys and model IDs", () => {
    expect(validKey("ftai_abc-DEF_1")).toBe(true);
    expect(validKey("sk-abc")).toBe(false);
    expect(validKey("ftai_a b")).toBe(false);
    expect(validModelId("openai/gpt-5.1")).toBe(true);
    expect(validModelId('x"; rm -rf')).toBe(false);
  });
});
