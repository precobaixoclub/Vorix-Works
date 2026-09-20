import { describe, expect, it } from "vitest";
import { groupDealsByStatus, isDealOpen, resolveActiveDeal } from "../features/crm/deal-resolution";
import type { Deal } from "../features/crm/types";

function makeDeal(overrides: Partial<Deal> & { id: string }): Deal {
  return {
    tenantId: "t1",
    workspaceId: "w1",
    pipelineId: "p1",
    stageId: "s1",
    title: "Negócio",
    valueCents: 1000,
    currency: "BRL",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastStageChangedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isDealOpen", () => {
  it("é aberto sem wonAt/lostAt", () => {
    expect(isDealOpen(makeDeal({ id: "d1" }))).toBe(true);
  });

  it("não é aberto quando ganho", () => {
    expect(isDealOpen(makeDeal({ id: "d1", wonAt: "2026-01-02T00:00:00.000Z" }))).toBe(false);
  });

  it("não é aberto quando perdido", () => {
    expect(isDealOpen(makeDeal({ id: "d1", lostAt: "2026-01-02T00:00:00.000Z" }))).toBe(false);
  });
});

describe("resolveActiveDeal", () => {
  it("sem negócios, não há atual", () => {
    expect(resolveActiveDeal([]).current).toBeUndefined();
  });

  it("prioriza o negócio aberto mais recentemente atualizado", () => {
    const older = makeDeal({ id: "older", lastStageChangedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeDeal({ id: "newer", lastStageChangedAt: "2026-01-05T00:00:00.000Z" });
    const { current, openDeals } = resolveActiveDeal([older, newer]);
    expect(current?.id).toBe("newer");
    expect(openDeals.map((deal) => deal.id)).toEqual(["newer", "older"]);
  });

  it("ganho/perdido nunca contam como atual quando há outro negócio aberto", () => {
    const won = makeDeal({ id: "won", wonAt: "2026-02-01T00:00:00.000Z", lastStageChangedAt: "2026-02-01T00:00:00.000Z" });
    const open = makeDeal({ id: "open", lastStageChangedAt: "2026-01-01T00:00:00.000Z" });
    const { current } = resolveActiveDeal([won, open]);
    expect(current?.id).toBe("open");
  });

  it("sem negócio aberto, não há atual mesmo havendo ganhos/perdidos", () => {
    const won = makeDeal({ id: "won", wonAt: "2026-02-01T00:00:00.000Z" });
    const lost = makeDeal({ id: "lost", lostAt: "2026-02-02T00:00:00.000Z" });
    expect(resolveActiveDeal([won, lost]).current).toBeUndefined();
  });
});

describe("groupDealsByStatus", () => {
  it("separa em andamento/ganhos/perdidos", () => {
    const open = makeDeal({ id: "open" });
    const won = makeDeal({ id: "won", wonAt: "2026-02-01T00:00:00.000Z" });
    const lost = makeDeal({ id: "lost", lostAt: "2026-02-01T00:00:00.000Z" });
    const groups = groupDealsByStatus([open, won, lost]);
    expect(groups.open.map((deal) => deal.id)).toEqual(["open"]);
    expect(groups.won.map((deal) => deal.id)).toEqual(["won"]);
    expect(groups.lost.map((deal) => deal.id)).toEqual(["lost"]);
  });
});
