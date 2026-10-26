"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { interactiveSocialConnection } from "@/features/social/api";
import { NETWORK_LABEL } from "@/features/social/presentation";
import { SOCIAL_NETWORKS, type SocialConnectionFrame } from "@/features/social/types";

export default function ConnectPage() { return <Suspense><InteractiveConnection /></Suspense>; }

function InteractiveConnection() {
  const workspace = useCurrentWorkspace(); const params = useSearchParams(); const router = useRouter();
  const network = SOCIAL_NETWORKS.find(value => value === params.get("network")); const flow = params.get("flow");
  const [frame, setFrame] = useState<SocialConnectionFrame>(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const surface = useRef<HTMLDivElement>(null); const input = useRef<HTMLInputElement>(null); const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const back = `/workspaces/${workspace.id}/social/integrations`;

  useEffect(() => {
    if (!network || !flow) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await interactiveSocialConnection<SocialConnectionFrame>(workspace.id, network, flow, "frame"); if (!stopped) setFrame(next); }
      catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : "Não foi possível abrir a conexão."); }
      if (!stopped) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [workspace.id, network, flow]);

  function send(action: unknown) {
    if (!network || !flow || busy) return;
    // Input exists only in memory until delivered, and is never persisted in browser storage.
    queue.current = queue.current.then(() => interactiveSocialConnection(workspace.id, network, flow, "interact", action)).catch(cause => setError(cause instanceof Error ? cause.message : "Tente novamente."));
  }
  async function finish(cancel: boolean) {
    if (!network || !flow) return;
    setBusy(true); setError("");
    try { await queue.current; await interactiveSocialConnection(workspace.id, network, flow, cancel ? "cancel" : "finish"); router.replace(cancel ? back : `${back}?connected=${network}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Conclua o login para continuar."); setBusy(false); }
  }
  if (!network || !flow) return <p>Conexão inválida. Volte às integrações e clique em Conectar.</p>;
  return <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-8">
    <PageHeader title={`Conectar ${NETWORK_LABEL[network]}`} description="Entre na sua conta na tela abaixo. Conclua as verificações solicitadas pela rede e clique em Continuar." />
    {frame?.status === "CHECKPOINT_REQUIRED" ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">A rede solicitou uma confirmação de segurança. Conclua a verificação nesta tela ou no aplicativo para continuar.</p> : null}
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    <Card className="overflow-hidden p-0">
      <div ref={surface} tabIndex={0} role="application" aria-label={`Login do ${NETWORK_LABEL[network]}. Clique no campo desejado e digite.`} className="outline-none focus:ring-2 focus:ring-primary" onKeyDown={event => {
        event.preventDefault();
        const allowed = ["Enter", "Tab", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"];
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") send({ kind: "key", key: "Control+A" });
        else if (allowed.includes(event.key)) send({ kind: "key", key: event.shiftKey && event.key === "Tab" ? "Shift+Tab" : event.key });
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) send({ kind: "text", text: event.key });
      }} onPaste={event => { event.preventDefault(); send({ kind: "text", text: event.clipboardData.getData("text").slice(0, 2000) }); }} onWheel={event => send({ kind: "scroll", delta: Math.max(-1600, Math.min(1600, Math.round(event.deltaY))) })}>
        {frame ? <img src={`data:image/jpeg;base64,${frame.image}`} alt={`Tela de autenticação do ${NETWORK_LABEL[network]}`} className="block h-auto w-full touch-none" draggable={false} onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(); pointer.current = { x: Math.min(1279, Math.max(0, (event.clientX - rect.left) * 1280 / rect.width)), y: Math.min(799, Math.max(0, (event.clientY - rect.top) * 800 / rect.height)) }; event.currentTarget.setPointerCapture(event.pointerId); surface.current?.focus({ preventScroll: true }); }} onPointerCancel={() => { pointer.current = null; }} onPointerUp={event => { const start = pointer.current; pointer.current = null; if (!start) return; const rect = event.currentTarget.getBoundingClientRect(); const x = Math.min(1279, Math.max(0, (event.clientX - rect.left) * 1280 / rect.width)); const y = Math.min(799, Math.max(0, (event.clientY - rect.top) * 800 / rect.height)); send(Math.hypot(x - start.x, y - start.y) > 4 ? { kind: "drag", ...start, toX: x, toY: y } : { kind: "click", x, y }); }} /> : <p className="p-12">Abrindo conexão…</p>}
      </div>
    </Card>
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">Para digitar pelo celular: <input ref={input} type="password" autoComplete="off" aria-label="Texto para o campo selecionado na rede" className="rounded border bg-background p-2" /></label>
      <Button variant="secondary" onClick={() => { const value = input.current?.value; if (input.current) input.current.value = ""; if (value) send({ kind: "text", text: value }); }}>Enviar ao campo selecionado</Button>
      <Button variant="secondary" onClick={() => send({ kind: "key", key: "Tab" })}>Próximo campo</Button>
      <Button variant="secondary" onClick={() => send({ kind: "key", key: "Enter" })}>Enter</Button>
    </div>
    <p className="text-sm text-muted-foreground">O Vorix não guarda sua senha nem códigos de verificação. A conexão expira automaticamente após alguns minutos.</p>
    <div className="flex justify-end gap-2"><Button disabled={busy} variant="secondary" onClick={() => void finish(true)}>Cancelar</Button><Button disabled={busy || !frame} onClick={() => void finish(false)}>{busy ? "Verificando…" : "Continuar"}</Button></div>
  </div>;
}
