"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { META_ADS_RETURN_PATH_KEY } from "@/app/meta-ads/callback/page";
import { beginMetaAdsOAuth, disconnectMetaAdsAccount } from "./api";
import { useMetaAdAccounts, useMetaAdsOAuthStatus } from "./hooks";

type HumanConnectionStatus = "connected" | "needs_attention" | "disconnected" | "syncing";

/**
 * Conexão do Meta Ads do workspace — mora dentro de Anúncios (é ali que ela é usada). Uma conexão é
 * UMA credencial (`meta_ads:...`); as contas de anúncio descobertas embaixo dela não se desconectam
 * uma a uma, só a conexão inteira.
 */
export function MetaAdsConnectionCard({ workspaceId, returnPath, onChanged }: { workspaceId: string; returnPath: string; onChanged?: () => void }) {
  const { data: oauth, mutate } = useMetaAdsOAuthStatus(workspaceId);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const references = oauth?.credentialReferences.filter((reference) => reference.status !== "revoked") ?? [];
  const activeReference = references.find((reference) => reference.status === "active");
  const { data: accountsData } = useMetaAdAccounts(workspaceId, Boolean(activeReference));
  const accounts = accountsData?.accounts.filter((account) => account.isActive) ?? [];

  const connected = Boolean(activeReference);
  const configured = oauth?.configured !== false;
  const humanStatus: HumanConnectionStatus = busy ? "syncing" : connected ? "connected" : references.length > 0 ? "needs_attention" : "disconnected";
  const statusText = !configured
    ? "A conexão de anúncios ainda não foi liberada no servidor. Fale com o suporte para ativar."
    : humanStatus === "connected"
      ? `${accounts.length} conta${accounts.length === 1 ? "" : "s"} de anúncio encontrada${accounts.length === 1 ? "" : "s"}`
      : humanStatus === "needs_attention"
        ? "Reconecte para voltar a sincronizar."
        : "Nenhuma conta de anúncio conectada.";

  async function connect() {
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await beginMetaAdsOAuth(workspaceId);
      window.sessionStorage.setItem(META_ADS_RETURN_PATH_KEY, returnPath);
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível iniciar a conexão.");
      setBusy(false);
    }
  }

  async function disconnect(credentialReferenceId: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await disconnectMetaAdsAccount(workspaceId, credentialReferenceId);
      await mutate();
      onChanged?.();
      setFeedback("Conexão de anúncios do Meta desconectada.");
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível desconectar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Megaphone className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Meta Ads</h2>
              <StatusBadge status={humanStatus} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Conta de anúncios do Facebook/Instagram usada nas campanhas deste espaço de trabalho.</p>
            <p className="mt-2 text-xs text-muted-foreground">{statusText}</p>
            {feedback ? <p className="mt-2 text-xs text-foreground">{feedback}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {activeReference ? (
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>
          ) : (
            <Button disabled={busy || !configured} onClick={() => void connect()}>{humanStatus === "needs_attention" ? "Reconectar" : "Conectar Meta Ads"}</Button>
          )}
        </div>
      </div>

      {accounts.length > 0 ? (
        <div className="border-t border-border bg-card/70 p-3 sm:p-4">
          <div className="grid gap-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{account.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{account.currency}{account.businessName ? ` · ${account.businessName}` : ""}</p>
                </div>
                <StatusBadge status={account.accountStatus === 1 ? "connected" : "needs_attention"} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeReference ? (
        <ConfirmDialog
          open={confirmDisconnect}
          title="Desconectar Meta Ads?"
          description={`Isso desconecta os anúncios deste espaço de trabalho${accounts.length > 0 ? ` e para de sincronizar ${accounts.length} conta${accounts.length === 1 ? "" : "s"} de anúncio` : ""}. As campanhas deixam de ser gerenciadas por aqui até você reconectar.`}
          confirmLabel="Desconectar"
          variant="danger"
          busy={busy}
          onConfirm={async () => {
            await disconnect(activeReference.credentialReferenceId);
            setConfirmDisconnect(false);
          }}
          onCancel={() => setConfirmDisconnect(false)}
        />
      ) : null}
    </Card>
  );
}
