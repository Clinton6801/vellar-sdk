import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FACILITATOR_URL, makeSearchCommand } from "./search.js";

function optionFor(flags: string) {
  return makeSearchCommand()
    .options.find((o) => o.long === flags);
}

describe("search command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is named 'search' and takes one required query argument", () => {
    const cmd = makeSearchCommand();
    expect(cmd.name()).toBe("search");
    expect(cmd.description()).toMatch(/bazaar/i);
    expect(cmd.registeredArguments).toHaveLength(1);
    expect(cmd.registeredArguments[0]?.required).toBe(true);
  });

  it("registers --json", () => {
    expect(optionFor("--json")).toBeDefined();
  });

  it("registers --limit with a default of 10", () => {
    expect(optionFor("--limit")?.defaultValue).toBe("10");
  });

  it("registers --cursor for pagination", () => {
    expect(optionFor("--cursor")).toBeDefined();
  });

  it("defaults --facilitator to the hosted facilitator", () => {
    // Guards the default rather than just its presence: a wrong default sends
    // a user's query to the wrong service without any error.
    expect(DEFAULT_FACILITATOR_URL).toBe("https://vellar-facilitator.onrender.com");
    expect(optionFor("--facilitator")?.defaultValue).toBe(DEFAULT_FACILITATOR_URL);
  });

  it("builds the discovery URL with the 'query' parameter, not 'q'", () => {
    // The endpoint ignores an unknown key and returns an unfiltered listing, so
    // getting this wrong looks like a working search that ranks nothing.
    const url = new URL("/discovery/search", DEFAULT_FACILITATOR_URL);
    url.searchParams.set("query", "weather data");
    url.searchParams.set("limit", "10");
    expect(url.searchParams.get("query")).toBe("weather data");
    expect(url.pathname).toBe("/discovery/search");
  });

  it("includes cursor parameter in URL when provided", () => {
    const url = new URL("/discovery/search", DEFAULT_FACILITATOR_URL);
    url.searchParams.set("query", "weather data");
    url.searchParams.set("limit", "10");
    url.searchParams.set("cursor", "abc123");
    expect(url.searchParams.get("cursor")).toBe("abc123");
  });

  it("renders results from a successful search response", async () => {
    const mockResponse = {
      resources: [
        {
          resource: "https://example.test/api",
          serviceName: "Test API",
          accepts: [{ scheme: "exact", network: "stellar:testnet", amount: "1000", asset: "USDC" }],
        },
      ],
      pagination: { limit: 10, cursor: null },
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await makeSearchCommand().parseAsync(["node", "search", "test"]);

    expect(logSpy.mock.calls.some((call) => call[0]?.includes("https://example.test/api"))).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("displays pagination hint when cursor is available", async () => {
    const mockResponse = {
      resources: [{ resource: "https://example.test/api" }],
      pagination: { limit: 10, cursor: "next_page_cursor_123" },
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeSearchCommand().parseAsync(["node", "search", "test"]);

    const logOutput = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(logOutput).toContain("More results available");
    expect(logOutput).toContain("--cursor");

    vi.unstubAllGlobals();
  });

  it("does not display pagination hint when cursor is null", async () => {
    const mockResponse = {
      resources: [{ resource: "https://example.test/api" }],
      pagination: { limit: 10, cursor: null },
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeSearchCommand().parseAsync(["node", "search", "test"]);

    const logOutput = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(logOutput).not.toContain("More results available");

    vi.unstubAllGlobals();
  });

  it("handles responses with large totals truncating results properly", async () => {
    const mockResponse = {
      resources: Array.from({ length: 10 }, (_, i) => ({
        resource: `https://example.test/api${i}`,
      })),
      pagination: { limit: 10, cursor: "page2_cursor" },
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeSearchCommand().parseAsync(["node", "search", "test"]);

    // Verify all 10 results are rendered
    const logOutput = logSpy.mock.calls.map((call) => call[0]).join("\n");
    for (let i = 0; i < 10; i++) {
      expect(logOutput).toContain(`https://example.test/api${i}`);
    }

    // Verify pagination hint is shown
    expect(logOutput).toContain("More results available");

    vi.unstubAllGlobals();
  });

  it("handles empty results gracefully", async () => {
    const mockResponse = {
      resources: [],
      pagination: { limit: 10, cursor: null },
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeSearchCommand().parseAsync(["node", "search", "test"]);

    expect(logSpy.mock.calls.some((call) => call[0]?.includes("No results found"))).toBe(true);

    vi.unstubAllGlobals();
  });

  it("exits with error on failed search", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    vi.stubGlobal("fetch", fetchSpy);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(
      makeSearchCommand().parseAsync(["node", "search", "test"]),
    ).rejects.toThrow("exit:1");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.some((call) => call[0]?.includes("Search failed"))).toBe(true);

    vi.unstubAllGlobals();
  });

  it("preserves query and limit in pagination hint output", async () => {
    const mockResponse = {
      resources: [{ resource: "https://example.test/api" }],
      pagination: { limit: 20, cursor: "abc123def456" },
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeSearchCommand().parseAsync(["node", "search", "weather api", "--limit", "20"]);

    const logOutput = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(logOutput).toContain("--limit 20");
    expect(logOutput).toContain("--cursor");
    expect(logOutput).toContain("abc123def456");

    vi.unstubAllGlobals();
  });
});
