import { describe, expect, it } from "vitest";
import { teamForUser, type TeamWithMembers } from "@/features/identity/member-teams";
import type { Team } from "@/features/identity/types";

const team = (id: string, name: string, isDefault = false): Team => ({ id, name, isDefault, tenantId: "t", workspaceId: "w", roundRobinEnabled: true, lastAssignedIndexByLevel: {}, timezone: "America/Sao_Paulo", createdAt: "", updatedAt: "" });
const entries: TeamWithMembers[] = [
  { team: team("default", "Equipe padrão", true), userIds: ["ana", "bia"] },
  { team: team("vendas", "Vendas"), userIds: ["ana", "caio"] },
  { team: team("atacado", "Atacado"), userIds: ["ana"] },
];

describe("teamForUser — equipe padrão de uma oportunidade pelo responsável", () => {
  it("usa a equipe a que o responsável pertence", () => {
    expect(teamForUser(entries, "caio")).toBe("vendas");
  });
  it("em várias equipes, prefere a do contexto (ex.: a da conversa) se ele for membro", () => {
    expect(teamForUser(entries, "ana", "vendas")).toBe("vendas");
  });
  it("sem contexto válido, prefere uma equipe específica (por nome) à equipe padrão", () => {
    expect(teamForUser(entries, "ana")).toBe("atacado");
    expect(teamForUser(entries, "ana", "equipe-de-que-ela-nao-faz-parte")).toBe("atacado");
  });
  it("só na equipe padrão → a padrão; sem equipe, sem responsável ou sem dados → vazio", () => {
    expect(teamForUser(entries, "bia")).toBe("default");
    expect(teamForUser(entries, "ninguem")).toBe("");
    expect(teamForUser(entries, "")).toBe("");
    expect(teamForUser(undefined, "ana")).toBe("");
  });
});
