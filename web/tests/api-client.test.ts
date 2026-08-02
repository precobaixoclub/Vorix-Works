import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError } from "../lib/api-client";

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiClient", () => {
  it("desembrulha o envelope de sucesso e devolve só `data`", async () => {
    mockFetchOnce({ ok: true, data: { id: "workspace-1", name: "Rumo ao Altar" } });
    const result = await apiClient.get<{ id: string; name: string }>("/v1/workspaces/workspace-1");
    expect(result).toEqual({ id: "workspace-1", name: "Rumo ao Altar" });
  });

  it("lança ApiError com code/message/statusCode/recoverable do envelope de erro", async () => {
    mockFetchOnce({ ok: false, error: { code: "NOT_FOUND", message: "Workspace não existe.", recoverable: true } }, 404);

    await expect(apiClient.get("/v1/workspaces/nao-existe")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Workspace não existe.",
      statusCode: 404,
      recoverable: true,
    });
  });

  it("erro de rede vira ApiError NETWORK_ERROR, nunca uma exceção crua do fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    await expect(apiClient.get("/v1/workspaces")).rejects.toBeInstanceOf(ApiError);
    await expect(apiClient.get("/v1/workspaces")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("POST envia o payload serializado e devolve os dados", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      json: async () => ({ ok: true, data: { id: "workspace-2" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.post("/v1/workspaces", { name: "Novo" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Novo" });
  });
});
