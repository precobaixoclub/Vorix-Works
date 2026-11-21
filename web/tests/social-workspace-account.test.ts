import { describe, expect, it } from "vitest";
import { pickWorkspaceAccount, workspaceAccountIds } from "../features/social/workspace-account";
import type { SocialAccountView } from "../features/social/types";

const view = (network: SocialAccountView["network"], externalAccountId: string, status: SocialAccountView["status"] = "HEALTHY"): SocialAccountView => ({
  id: `soc-${externalAccountId}`,
  network,
  externalAccountId,
  status,
  statusLabel: "Conectada",
  needsReconnect: false,
  waitingPublications: 0,
});

// Uma autorização da Meta trouxe várias Páginas; a workspace da Vorix escolheu só a "Vorix Works".
const facebookAuthorized = [
  { credentialReferenceId: "fb-pbc", providerSubjectId: "1300342786497744", status: "active", connectedAt: "2026-11-21T20:53:34.982Z" },
  { credentialReferenceId: "fb-vorix", providerSubjectId: "1369899176217140", status: "active", connectedAt: "2026-11-21T20:53:34.882Z" },
  { credentialReferenceId: "fb-other", providerSubjectId: "266244049915187", status: "active", connectedAt: "2026-11-21T20:53:35.056Z" },
];

describe("conta da workspace na tela Publicar", () => {
  it("publica na Página escolhida em Integrações, não na primeira autorizada", () => {
    const chosen = workspaceAccountIds([view("facebook", "1369899176217140"), view("instagram", "17841420145296121")], "facebook");
    expect(pickWorkspaceAccount(facebookAuthorized, chosen, (account) => account.providerSubjectId)?.credentialReferenceId).toBe("fb-vorix");
  });

  it("não publica quando a conta escolhida não tem autorização ativa", () => {
    const chosen = workspaceAccountIds([view("facebook", "999")], "facebook");
    expect(pickWorkspaceAccount(facebookAuthorized, chosen, (account) => account.providerSubjectId)).toBeUndefined();
  });

  it("ignora contas desconectadas da workspace", () => {
    const chosen = workspaceAccountIds([view("facebook", "1300342786497744", "DISCONNECTED"), view("facebook", "1369899176217140")], "facebook");
    expect([...chosen!]).toEqual(["1369899176217140"]);
  });

  it("sem conta definida na workspace, usa a autorização mais recente", () => {
    const youtube = [
      { credentialReferenceId: "yt-old", channelId: "UCold", status: "active", connectedAt: "2026-08-24T16:06:44.765Z" },
      { credentialReferenceId: "yt-new", channelId: "UCnew", status: "active", connectedAt: "2026-11-21T19:03:33.992Z" },
    ];
    expect(pickWorkspaceAccount(youtube, workspaceAccountIds([], "youtube"), (account) => account.channelId)?.credentialReferenceId).toBe("yt-new");
  });

  it("enquanto as contas da workspace carregam, nada é escolhido", () => {
    expect(pickWorkspaceAccount(facebookAuthorized, workspaceAccountIds(undefined, "facebook"), (account) => account.providerSubjectId)).toBeUndefined();
  });
});
