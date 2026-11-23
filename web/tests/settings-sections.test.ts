import { describe, expect, it } from "vitest";
import { settingsSectionsFor } from "@/components/settings/SettingsShell";
import { SETTINGS_CATEGORIES, integrationState, settingsSectionFromPath } from "@/features/settings/sections";
import type { SolutionKey } from "@/lib/solutions";

const ALL: SolutionKey[] = ["site", "conversations", "meetings", "marketing"];
const labels = (available: SolutionKey[] | undefined) => settingsSectionsFor(available).map((section) => `${section.category}:${section.label}`);

// Fase 10: as configurações aparecem conforme as ferramentas CONTRATADAS (antes: só as da ferramenta
// "ativa" da sessão — quem estava em Conversas não achava as de Reuniões). Ferramenta não contratada
// continua sem nenhuma entrada.
describe("configurações unificadas (Fase 10)", () => {
  it("conta completa: Minha conta, Espaço de trabalho, cada ferramenta, Integrações e Conta e assinatura", () => {
    const all = labels(ALL);
    expect(all).toContain("Minha conta:Meu perfil");
    expect(all).toContain("Espaço de trabalho:Usuários e permissões");
    expect(all).toContain("Espaço de trabalho:Marca e identidade");
    expect(all).toContain("Atendimento e vendas:Encerramento e avaliação");
    expect(all).toContain("Site:Endereço e domínio");
    expect(all).toContain("Reuniões:Contas de gravação");
    expect(all).toContain("Integrações:Redes sociais");
    expect(all).toContain("Integrações:Agenda e reuniões");
    expect(all).toContain("Conta e assinatura:Plano e cobrança");
    expect(new Set(settingsSectionsFor(ALL).map((section) => section.value)).size).toBe(settingsSectionsFor(ALL).length);
  });

  it("só o Site: nada de Atendimento, Metas, Automações, Reuniões ou Marca", () => {
    const site = labels(["site"]);
    expect(site).toContain("Site:Endereço e domínio");
    expect(site).toContain("Site:Produtos");
    expect(site.some((label) => /Atendimento|Metas|Automações|Contas de gravação|Marca|Redes sociais|Agenda/.test(label))).toBe(false);
  });

  it("um catálogo só: com Conversas, Produtos é o do CRM (sem o do Site repetido)", () => {
    const sections = settingsSectionsFor(["site", "conversations"]);
    expect(sections.filter((section) => section.label === "Produtos").map((section) => section.href)).toEqual(["/products"]);
  });

  it("só Reuniões: preferências, contas de gravação e agenda — nada de outras ferramentas", () => {
    const meetings = labels(["meetings"]);
    expect(meetings).toContain("Reuniões:Preferências de reuniões");
    expect(meetings.some((label) => /Regras comerciais|Endereço e domínio|Marca/.test(label))).toBe(false);
  });

  it("enquanto as ferramentas carregam, só o que é comum a todas aparece", () => {
    expect(settingsSectionsFor(undefined).every((section) => !section.solutions)).toBe(true);
    expect(labels(undefined)).toEqual(["Minha conta:Meu perfil", "Espaço de trabalho:Geral", "Espaço de trabalho:Usuários e permissões", "Espaço de trabalho:Equipes", "Integrações:Todas as integrações", "Conta e assinatura:Plano e cobrança"]);
  });

  it("categorias em ordem e seção atual pela rota", () => {
    expect(SETTINGS_CATEGORIES[0]).toBe("Minha conta");
    expect(SETTINGS_CATEGORIES.at(-1)).toBe("Conta e assinatura");
    expect(settingsSectionFromPath("/workspaces/ws/settings/perfil", "/workspaces/ws")).toBe("profile");
    expect(settingsSectionFromPath("/workspaces/ws/settings/integracoes", "/workspaces/ws")).toBe("integrations-hub");
    expect(settingsSectionFromPath("/workspaces/ws/settings", "/workspaces/ws")).toBe("general");
    expect(settingsSectionFromPath("/workspaces/ws/connections", "/workspaces/ws")).toBe("integrations");
  });

  it("estado de integração só com o que o servidor informou", () => {
    expect(integrationState("connected")).toBe("connected");
    expect(integrationState("pending")).toBe("attention");
    expect(integrationState("reconnect_required")).toBe("attention");
    expect(integrationState("disconnected")).toBe("disconnected");
    expect(integrationState("not_connected")).toBe("disconnected");
    expect(integrationState("weird")).toBe("unknown");
    expect(integrationState(undefined)).toBe("unknown");
  });
});
