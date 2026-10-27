import { afterEach, describe, expect, it, vi } from "vitest";
import { captureUtm, cartToken, openWhatsapp, storeCartToken, visitorSessionId } from "@/features/sites/storefront";

function memoryStorage(fail = false) {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => { if (fail) throw new Error("blocked"); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (fail) throw new Error("blocked"); data.set(key, value); },
    removeItem: (key: string) => { if (fail) throw new Error("blocked"); data.delete(key); },
  };
}
function browser(url: string, { blocked = false, popup }: { blocked?: boolean; popup?: { location: { href: string }; closed: boolean; opener: unknown; close: () => void } | null } = {}) {
  const assign = vi.fn();
  const window = { localStorage: memoryStorage(blocked), sessionStorage: memoryStorage(blocked), location: { href: url, search: new URL(url).search, assign }, open: vi.fn(() => popup ?? null) };
  vi.stubGlobal("window", window);
  return window;
}
afterEach(() => vi.unstubAllGlobals());

describe("vitrine — visitante anônimo", () => {
  it("mantém o mesmo identificador anônimo por site e separa sites diferentes", () => {
    browser("https://loja.test/");
    const first = visitorSessionId("loja-a");
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(visitorSessionId("loja-a")).toBe(first);
    expect(visitorSessionId("loja-b")).not.toBe(first);
  });

  it("preserva as UTMs da entrada ao navegar para páginas sem UTM", () => {
    const win = browser("https://loja.test/?utm_source=instagram&utm_medium=social&utm_campaign=verao&outro=1");
    expect(captureUtm("loja")).toEqual({ source: "instagram", medium: "social", campaign: "verao" });
    win.location.search = "";
    expect(captureUtm("loja")).toEqual({ source: "instagram", medium: "social", campaign: "verao" });
    win.location.search = "?utm_source=google";
    expect(captureUtm("loja")).toEqual({ source: "google" });
  });

  it("aba anônima com armazenamento bloqueado não quebra a página", () => {
    browser("https://loja.test/?utm_source=x", { blocked: true });
    expect(visitorSessionId("loja")).toMatch(/^[a-f0-9]{32}$/);
    expect(captureUtm("loja")).toEqual({ source: "x" });
    expect(cartToken("loja")).toBeUndefined();
    expect(() => storeCartToken("loja", "token")).not.toThrow();
  });

  it("abre a aba antes de esperar a API e manda para /i/:referência no mesmo endereço do site", async () => {
    const popup = { location: { href: "" }, closed: false, opener: {}, close: vi.fn() };
    browser("https://loja.test/s/minha-loja/produto/camiseta", { popup });
    await openWhatsapp(async () => ({ reference: "VX-A8F2KM", redirectPath: "/i/VX-A8F2KM", whatsappUrl: "https://wa.me/1" }), "/s/minha-loja");
    expect(popup.location.href).toBe("https://loja.test/s/minha-loja/i/VX-A8F2KM");
    expect(popup.opener).toBeNull();
  });

  it("sem pop-up (bloqueado) segue na mesma aba; erro fecha a aba aberta", async () => {
    const win = browser("https://loja.test/produto/camiseta", { popup: null });
    await openWhatsapp(async () => ({ reference: "VX-A8F2KM", redirectPath: "", whatsappUrl: "" }), "");
    expect(win.location.assign).toHaveBeenCalledWith("https://loja.test/i/VX-A8F2KM");
    const popup = { location: { href: "" }, closed: false, opener: {}, close: vi.fn() };
    browser("https://loja.test/", { popup });
    await expect(openWhatsapp(async () => { throw new Error("indisponível"); }, "")).rejects.toThrow("indisponível");
    expect(popup.close).toHaveBeenCalled();
  });
});
