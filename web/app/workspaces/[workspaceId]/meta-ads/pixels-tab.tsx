"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { formatDateTime } from "@/lib/format";
import { createMetaPixel, sendMetaCapiEvent, syncMetaPixels } from "@/features/meta-ads/api";
import { useMetaCapiEvents, useMetaPixels } from "@/features/meta-ads/hooks";
import type { MetaAdAccount, MetaPixel } from "@/features/meta-ads/types";

const EVENT_NAMES = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Lead", "CompleteRegistration", "Purchase"];

export function PixelsTab({ workspaceId, adAccount }: { workspaceId: string; adAccount: MetaAdAccount }) {
  const { data, isLoading, error, mutate } = useMetaPixels(workspaceId, adAccount.id);
  const pixels = data?.pixels ?? [];
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [newPixelOpen, setNewPixelOpen] = useState(false);
  const [testingPixel, setTestingPixel] = useState<MetaPixel | undefined>();

  async function handleSync() {
    setSyncing(true);
    setFeedback(undefined);
    try {
      const result = await syncMetaPixels(workspaceId, adAccount.id);
      await mutate();
      setFeedback(`Sincronizado: ${result.pixelsSynced} pixel(is).`);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Pixels desta conta — envie eventos de teste pra validar a Conversions API antes de integrar no seu site.</p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={syncing} onClick={handleSync}>{syncing ? "Sincronizando..." : "Sincronizar"}</Button>
          <Button onClick={() => setNewPixelOpen(true)}>+ Pixel</Button>
        </div>
      </div>

      {feedback ? <Card className="mb-4 border-accent/30 bg-accent-soft/30 p-3"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-accent" /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : pixels.length === 0 ? (
        <EmptyState title="Nenhum pixel ainda" description="Crie um pixel novo, ou clique em Sincronizar para importar pixels já existentes desta conta." />
      ) : (
        <div className="grid gap-2">
          {pixels.map((pixel) => (
            <PixelRow key={pixel.id} workspaceId={workspaceId} pixel={pixel} onTest={() => setTestingPixel(pixel)} />
          ))}
        </div>
      )}

      {newPixelOpen ? (
        <NewPixelModal
          workspaceId={workspaceId}
          adAccount={adAccount}
          onClose={() => setNewPixelOpen(false)}
          onCreated={async () => {
            setNewPixelOpen(false);
            await mutate();
            setFeedback("Pixel criado.");
          }}
        />
      ) : null}

      {testingPixel ? <TestEventModal workspaceId={workspaceId} pixel={testingPixel} onClose={() => setTestingPixel(undefined)} /> : null}
    </div>
  );
}

function PixelRow({ workspaceId, pixel, onTest }: { workspaceId: string; pixel: MetaPixel; onTest: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const { data: eventsData, isLoading } = useMetaCapiEvents(workspaceId, expanded ? pixel.id : undefined);
  const events = eventsData?.events ?? [];

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{pixel.name}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            id {pixel.pixelId}{pixel.lastFiredTime ? ` · último disparo ${formatDateTime(pixel.lastFiredTime)}` : " · nunca disparou"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setExpanded(!expanded)}>{expanded ? "Ocultar eventos" : "Ver eventos"}</Button>
          <Button className="px-2.5 py-1.5 text-xs" onClick={onTest}>Enviar evento de teste</Button>
        </div>
      </div>
      {expanded ? (
        <div className="border-t border-border bg-surface/70 p-3">
          {isLoading ? (
            <div className="flex justify-center py-4"><Spinner className="h-5 w-5 text-accent" /></div>
          ) : events.length === 0 ? (
            <p className="text-xs text-ink-muted">Nenhum evento enviado por aqui ainda.</p>
          ) : (
            <div className="grid gap-1.5">
              {events.map((event) => (
                <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={event.status === "sent" ? "text-ink" : "text-red-600"}>{event.eventName}</span>
                    <span className="text-ink-muted">{event.userDataFields.join(", ") || "sem user_data"}</span>
                    {event.testEventCode ? <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] text-ink-muted">teste</span> : null}
                  </div>
                  <span className="text-ink-muted">
                    {event.status === "sent" ? `recebido (${event.eventsReceived ?? 0})` : (event.errorMessage ?? "falhou")} · {formatDateTime(event.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function NewPixelModal({ workspaceId, adAccount, onClose, onCreated }: { workspaceId: string; adAccount: MetaAdAccount; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Dê um nome pro pixel.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await createMetaPixel(workspaceId, { adAccountId: adAccount.id, name: name.trim() });
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o pixel.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Novo pixel" onClose={onClose}>
      <div className="grid gap-4">
        <div>
          <Label htmlFor="pixel-name">Nome</Label>
          <Input id="pixel-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Pixel Loja Principal" autoFocus />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={handleSubmit}>{submitting ? "Criando..." : "Criar pixel"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function TestEventModal({ workspaceId, pixel, onClose }: { workspaceId: string; pixel: MetaPixel; onClose: () => void }) {
  const [eventName, setEventName] = useState(EVENT_NAMES[0]!);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [testEventCode, setTestEventCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<{ eventsReceived?: number; fbtraceId?: string } | undefined>();

  async function handleSubmit() {
    if (!email.trim() && !phone.trim()) {
      setError("Informe pelo menos e-mail ou telefone pra identificar a pessoa.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await sendMetaCapiEvent(workspaceId, pixel.id, {
        eventName,
        userData: { email: email || undefined, phone: phone || undefined },
        ...(value ? { customData: { value: Number(value), currency } } : {}),
        ...(testEventCode ? { testEventCode } : {}),
      });
      setResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar o evento.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Enviar evento — ${pixel.name}`} onClose={onClose} maxWidthClass="sm:max-w-lg">
      <div className="grid gap-4">
        <p className="text-xs text-ink-muted">
          E-mail/telefone são hasheados antes de sair do servidor — nunca trafegam nem ficam salvos em texto puro. Preencha o "Código de teste" (do painel Testar eventos do Events Manager) pra validar sem contaminar dados reais.
        </p>
        <div>
          <Label htmlFor="capi-event-name">Evento</Label>
          <select id="capi-event-name" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={eventName} onChange={(event) => setEventName(event.target.value)}>
            {EVENT_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="capi-email">E-mail</Label>
            <Input id="capi-email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="pessoa@exemplo.com" autoFocus />
          </div>
          <div>
            <Label htmlFor="capi-phone">Telefone</Label>
            <Input id="capi-phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="11999998888" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="capi-value">Valor (opcional)</Label>
            <Input id="capi-value" type="number" min={0} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} placeholder="99.90" />
          </div>
          <div>
            <Label htmlFor="capi-currency">Moeda</Label>
            <Input id="capi-currency" value={currency} onChange={(event) => setCurrency(event.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="capi-test-code">Código de teste (Events Manager → Testar eventos)</Label>
          <Input id="capi-test-code" value={testEventCode} onChange={(event) => setTestEventCode(event.target.value)} placeholder="TEST12345" />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {result ? (
          <p className="text-sm text-ink">Enviado — {result.eventsReceived ?? 0} evento(s) recebido(s) pela Meta{result.fbtraceId ? ` (fbtrace ${result.fbtraceId})` : ""}.</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button disabled={submitting} onClick={handleSubmit}>{submitting ? "Enviando..." : "Enviar evento"}</Button>
        </div>
      </div>
    </Modal>
  );
}
