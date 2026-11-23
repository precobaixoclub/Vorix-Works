import { describe, expect, it } from "vitest";
import { firstStepsFor } from "@/features/onboarding/first-steps";
import { PUBLIC_FAQ } from "@/features/public-site/catalog";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

describe("Fase 13 — onboarding e site público", () => {
  it("primeiros passos só das ferramentas contratadas, na ordem do produto, com links para telas existentes", () => {
    expect(firstStepsFor(["meetings", "conversations"]).map((tool) => tool.tool)).toEqual(["conversations", "meetings"]);
    expect(firstStepsFor([])).toEqual([]);
    const hrefs = firstStepsFor(["conversations", "marketing", "site", "meetings"]).flatMap((tool) => tool.steps.map((step) => step.href));
    expect(hrefs).toEqual(["/conversas?aba=canais", "/deals", "/settings/marca", "/social/integrations", "/site?section=modelos", "/site?section=loja", "/meetings/integrations", "/meetings/recorder-accounts"]);
  });
  it("FAQ não chama a loja do Site de 'em preparação' e explica o Marketing", () => {
    const text = PUBLIC_FAQ.map(([question, answer]) => `${question} ${answer}`).join(" ");
    expect(text).not.toContain("em preparação");
    expect(PUBLIC_FAQ.some(([question]) => question.includes("Marketing"))).toBe(true);
  });
  it("sitemap com as quatro páginas de produto e nenhuma área privada; robots bloqueia o app", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const product of ["conversas", "marketing", "site", "meetings"]) expect(urls).toContain(`https://vorixworks.com/produtos/${product}`);
    expect(urls.some((url) => /\/(workspaces|admin|conta|login)\b/.test(url))).toBe(false);
    const rules = robots().rules;
    expect(JSON.stringify(rules)).toContain("/workspaces/");
    expect(JSON.stringify(rules)).toContain("/admin/");
  });
});
