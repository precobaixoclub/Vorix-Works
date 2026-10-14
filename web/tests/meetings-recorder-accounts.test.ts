import { describe, expect, it } from "vitest";
import { SOLUTION_NAVIGATION } from "../components/workspace-navigation";
import { keyDownMessage, keyUpMessage, parseFrame, pasteMessage, streamUrl } from "../features/meetings/remote-login";
import { HUMAN_IDENTITY_SOURCE_LABEL, RECORDER_ACCOUNT_ACTION_REASONS, RECORDER_HEALTH_LABEL } from "../features/meetings/types";
import { routeOwner } from "../lib/solutions";

const BASE = "/workspaces/ws-1";

describe("Contas de gravação — navegação", () => {
  it("fica em Meetings → Configurações e pertence à solução Meetings", () => {
    const settings = SOLUTION_NAVIGATION.meetings.sections.find((section) => section.label === "CONFIGURAÇÕES");
    expect(settings?.items.map((item) => item.label)).toContain("Contas de gravação");
    expect(routeOwner(`${BASE}/meetings/recorder-accounts`, BASE)).toBe("meetings");
  });
});

describe("Recusas e rótulos", () => {
  it("só as recusas resolvidas nas contas levam o CTA de conectar outra conta", () => {
    expect([...RECORDER_ACCOUNT_ACTION_REASONS].sort()).toEqual(["INVALID_RECORDER_SESSION", "NO_RECORDER_ACCOUNT_AVAILABLE", "RECORDER_ACCOUNT_IDENTITY_CONFLICT"]);
    expect(RECORDER_ACCOUNT_ACTION_REASONS).not.toContain("HUMAN_IDENTITY_REQUIRED");
    expect(RECORDER_ACCOUNT_ACTION_REASONS).not.toContain("CONCURRENCY_LIMIT_REACHED");
  });

  it("explica a origem da identidade e a saúde da conta em português", () => {
    expect(HUMAN_IDENTITY_SOURCE_LABEL.explicit).toBe("Informada por você");
    expect(RECORDER_HEALTH_LABEL.needs_reconnect).toBe("Precisa reconectar");
  });
});

describe("Navegador remoto de login", () => {
  it("letras viram texto, teclas especiais vão por nome e atalhos ficam locais", () => {
    expect(keyDownMessage({ key: "a" })).toEqual({ t: "text", v: "a" });
    expect(keyDownMessage({ key: "@" })).toEqual({ t: "text", v: "@" });
    expect(keyDownMessage({ key: "Enter" })).toEqual({ t: "key", a: "down", key: "Enter" });
    expect(keyUpMessage({ key: "Enter" })).toEqual({ t: "key", a: "up", key: "Enter" });
    expect(keyUpMessage({ key: "a" })).toBeUndefined();
    expect(keyDownMessage({ key: "v", ctrlKey: true })).toBeUndefined();
    expect(keyDownMessage({ key: "F5" })).toBeUndefined();
  });

  it("colar é limitado e vazio não envia nada", () => {
    expect(pasteMessage("x".repeat(600))).toEqual({ t: "text", v: "x".repeat(512) });
    expect(pasteMessage("")).toBeUndefined();
  });

  it("lê largura/altura do frame e troca http por ws na URL", () => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint16(0, 1024);
    view.setUint16(2, 720);
    const frame = parseFrame(buffer);
    expect([frame?.width, frame?.height, frame?.jpeg.byteLength]).toEqual([1024, 720, 4]);
    expect(parseFrame(new ArrayBuffer(4))).toBeUndefined();
    expect(streamUrl("https://api.vorix.app/", "/v1/meetings/recorder-provisioning/stream")).toBe("wss://api.vorix.app/v1/meetings/recorder-provisioning/stream");
    expect(streamUrl("http://localhost:3000", "/x")).toBe("ws://localhost:3000/x");
  });
});
