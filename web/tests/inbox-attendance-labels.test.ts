import { describe, expect, it } from "vitest";
import { attendanceEventLabel, formatDuration, isShadowedStatusEvent, selectableClosureTypes } from "@/features/inbox/attendance-labels";
import type { InboxClosureType, InboxConversationEvent } from "@/features/inbox/types";

const names: Record<string, string> = { joao: "João", maria: "Maria" };
const who = (userId: string | undefined) => (userId ? names[userId] ?? userId : "Sem responsável");
const event = (patch: Partial<InboxConversationEvent>): InboxConversationEvent => ({ id: "e", conversationId: "c", type: "assigned", performedBy: "joao", createdAt: "2026-10-24T10:00:00Z", ...patch });

describe("marcos do ciclo de atendimento", () => {
  it("gera o texto a partir dos dados estruturados do evento", () => {
    expect(attendanceEventLabel(event({ type: "attendance_opened", performedBy: "system", toUserId: "joao", metadata: { number: 178, distributionRule: "round_robin" } }), who)).toBe("Novo atendimento #178 iniciado · rodízio da equipe · João");
    expect(attendanceEventLabel(event({ type: "transferred", fromUserId: "joao", toUserId: "maria" }), who)).toBe("Atendimento transferido de João para Maria");
    expect(attendanceEventLabel(event({ type: "kanban_phase_changed", metadata: { fromPhaseName: "Qualificação", toPhaseName: "Proposta" } }), who)).toBe("Movido de Qualificação para Proposta");
    expect(attendanceEventLabel(event({ type: "attendance_closed", performedBy: "maria", metadata: { number: 125, closureTypeName: "Resolvido", closureSubtypeName: "Dúvida comercial" } }), who)).toBe("Atendimento #125 finalizado por Maria — Resolvido > Dúvida comercial");
    expect(attendanceEventLabel(event({ type: "csat_sent" }), who)).toBe("Pesquisa de satisfação enviada");
    expect(attendanceEventLabel(event({ type: "csat_not_sent", reason: "waived", performedBy: "maria" }), who)).toBe("Pesquisa de satisfação dispensada por Maria");
    expect(attendanceEventLabel(event({ type: "attendance_reopened", performedBy: "joao", metadata: { number: 3 } }), who)).toBe("Atendimento #3 reaberto por João");
    expect(attendanceEventLabel(event({ type: "assigned", performedBy: "maria", toUserId: "joao" }), who)).toBe("Atendimento atribuído a João por Maria");
    expect(attendanceEventLabel(event({ type: "assigned", performedBy: "joao", toUserId: "joao" }), who)).toBe("Atendimento atribuído a João");
    expect(attendanceEventLabel(event({ type: "ai_paused" }), who)).toBeNull();
  });

  it("esconde a mudança de status que já aparece como marco do atendimento", () => {
    expect(isShadowedStatusEvent(event({ type: "status_changed", metadata: { attendanceId: "a1" } }))).toBe(true);
    expect(isShadowedStatusEvent(event({ type: "status_changed", metadata: { attendanceTracked: true } }))).toBe(true);
    expect(isShadowedStatusEvent(event({ type: "status_changed" }))).toBe(false);
  });

  it("finalização só oferece tipos ativos com subtipo ativo", () => {
    const sub = (id: string, isActive = true) => ({ id, closureTypeId: "t", name: id, position: 0, isActive });
    const types: InboxClosureType[] = [
      { id: "a", name: "Resolvido", position: 0, isActive: true, subtypes: [sub("a1"), sub("a2", false)] },
      { id: "b", name: "Sem subtipo ativo", position: 1, isActive: true, subtypes: [sub("b1", false)] },
      { id: "c", name: "Desativado", position: 2, isActive: false, subtypes: [sub("c1")] },
    ];
    const selectable = selectableClosureTypes(types);
    expect(selectable.map((type) => type.id)).toEqual(["a"]);
    expect(selectable[0].subtypes.map((subtype) => subtype.id)).toEqual(["a1"]);
  });

  it("formata durações curtas e longas", () => {
    expect(formatDuration(undefined)).toBe("--");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(240)).toBe("4 min");
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3h 5min");
    expect(formatDuration(26 * 3600)).toBe("1d 2h");
  });
});
