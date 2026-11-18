import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { fail, ok, parseJson } from "../../src/index.ts";

describe("PluginResult helpers", () => {
  test("ok carries the value", () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
  });

  test("retryable defaults by code: rate limits and outages pass, the rest need a change", () => {
    const retryable = (["auth", "not_found", "conflict", "rate_limited", "unavailable", "invalid", "unknown"] as const).map((c) => {
      const r = fail(c, "x");
      return r.ok ? null : [c, r.failure.retryable];
    });
    expect(retryable).toEqual([
      ["auth", false],
      ["not_found", false],
      ["conflict", false],
      ["rate_limited", true],
      ["unavailable", true],
      ["invalid", false],
      ["unknown", false],
    ]);
    expect(fail("unknown", "flaky", true)).toEqual({ ok: false, failure: { code: "unknown", message: "flaky", retryable: true } });
  });
});

describe("parseJson", () => {
  const Login = Type.Object({ login: Type.String({ minLength: 1 }) }, { additionalProperties: false });

  test("valid JSON of the schema's shape comes back as the value", () => {
    expect(parseJson(Login, '{"login":"octo"}', "gh api user")).toEqual({ ok: true, value: { login: "octo" } });
  });

  test("text that is not JSON is an invalid failure naming the source", () => {
    const r = parseJson(Login, "<html>", "gh api user");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("invalid");
      expect(r.failure.retryable).toBe(false);
      expect(r.failure.message).toStartWith("gh api user: not JSON");
    }
  });

  test("JSON of another shape is an invalid failure with the schema's pointer, never a guess", () => {
    expect(parseJson(Login, '{"login":""}', "gh api user")).toEqual({
      ok: false,
      failure: { code: "invalid", message: "gh api user: /login must NOT have fewer than 1 characters", retryable: false },
    });
    const extra = parseJson(Login, '{"login":"a","x":1}', "gh api user");
    expect(extra.ok ? null : extra.failure.message).toBe("gh api user: / unknown property 'x'");
  });
});
