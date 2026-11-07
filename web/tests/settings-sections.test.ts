import { describe, expect, it } from "vitest";
import { settingsSectionsFor } from "@/components/settings/SettingsShell";
import type { SolutionKey } from "@/lib/solutions";

const labels = (active: Parameters<typeof settingsSectionsFor>[0], available: SolutionKey[] = ["site", "conversations", "meetings", "marketing"]) => settingsSectionsFor(active, available).map((section) => `${section.group}:${section.label}`);

describe("configurações por solução", () => {
  it("no Vorix Site mostra só a Conta e as opções do site", () => {
    const site = labels("site");
    expect(site).toContain("Vorix Site:Endereço e domínio");
    expect(site).toContain("Conta:Plano e cobrança");
    expect(site.some((label) => /Atendimento|Metas|Automações|Contas de gravação|Marca/.test(label))).toBe(false);
  });
  it("cada solução vê só o próprio grupo", () => {
    expect(labels("conversations").filter((label) => !label.startsWith("Conta:")).every((label) => label.startsWith("Vorix Conversas:"))).toBe(true);
    expect(labels("meetings")).toContain("Vorix Meetings:Contas de gravação");
    expect(labels("meetings").some((label) => label.includes("Regras comerciais"))).toBe(false);
  });
  it("sem solução definida (carregando) ou não contratada, só a Conta aparece", () => {
    expect(labels(undefined).every((label) => label.startsWith("Conta:"))).toBe(true);
    expect(labels("meetings", ["site"]).every((label) => label.startsWith("Conta:"))).toBe(true);
  });
});
