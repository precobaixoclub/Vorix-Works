import { describe, expect, it } from "vitest";
import { activityActorLabel } from "../features/crm/presentation";
import type { ContactActivityActor } from "../features/crm/types";

const MEMBERS = [{ userId: "user-1", name: "Cleverton" }, { userId: "user-2", name: "Ana" }];

describe("activityActorLabel", () => {
  it("resolve o nome real de um usuário a partir da lista de membros", () => {
    expect(activityActorLabel({ type: "user", id: "user-1" }, MEMBERS)).toBe("Cleverton");
  });

  it("nunca mostra um UUID cru quando o usuário não está na lista de membros carregada", () => {
    expect(activityActorLabel({ type: "user", id: "user-999" }, MEMBERS)).toBe("Responsável não encontrado");
  });

  it("mapeia os tipos fixos pros rótulos esperados", () => {
    const cases: [ContactActivityActor, string][] = [
      [{ type: "ai" }, "IA"],
      [{ type: "automation" }, "Automação"],
      [{ type: "contact" }, "Cliente"],
      [{ type: "system" }, "Sistema"],
    ];
    for (const [actor, label] of cases) expect(activityActorLabel(actor, MEMBERS)).toBe(label);
  });

  it("funciona mesmo sem a lista de membros carregada ainda", () => {
    expect(activityActorLabel({ type: "user", id: "user-1" }, undefined)).toBe("Responsável não encontrado");
    expect(activityActorLabel({ type: "system" }, undefined)).toBe("Sistema");
  });
});
