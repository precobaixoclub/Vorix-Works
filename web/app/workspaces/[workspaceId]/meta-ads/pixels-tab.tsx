"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { ListCard } from "@/components/ListCard";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SortableHead } from "@/components/SortableHead";
import { Spinner } from "@/components/Spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useSortedRows } from "@/hooks/useSortedRows";
import { formatDateTime } from "@/lib/format";
import { createMetaPixel, sendMetaCapiEvent, syncMetaPixels } from "@/features/meta-ads/api";
import { useMetaCapiEvents, useMetaPixels } from "@/features/meta-ads/hooks";
import type { MetaAdAccount, MetaPixel } from "@/features/meta-ads/types";

const EVENT_NAMES = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Lead", "CompleteRegistration", "Purchase"];
type PixelSortKey = "name" | "lastFiredTime";

export function PixelsTab({ workspaceId, adAccount }: { workspaceId: string; adAccount: MetaAdAccount }) {
  const { data, isLoading, error, mutate } = useMetaPixels(workspaceId, adAccount.id);
  const pixels = data?.pixels ?? [];
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [newPixelOpen, setNewPixelOpen] = useState(false);
  const [testingPixel, setTestingPixel] = useState<MetaPixel | undefined>();
  const [viewingPixel, setViewingPixel] = useState<MetaPixel | undefined>();

  const { sorted, sort, onSort } = useSortedRows<MetaPixel, PixelSortKey>(
    pixels,
    { name: (pixel) => pixel.name.toLowerCase(), lastFiredTime: (pixel) => (pixel.lastFiredTime ? new Date(pixel.lastFiredTime).getTime() : null) },
    { key: "name", dir: "asc" },
  );
  const { currentPage, totalPages, paginatedItems, setCurrentPage, resetPage, totalItems, pageSize, containerRef, availableHeight } = usePagination(sorted, { auto: true });
  useEffect(() => { resetPage(); }, [sort, resetPage]);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Pixels desta conta — envie eventos de teste pra validar a Conversions API antes de integrar no seu site.</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={syncing} onClick={handleSync}>{syncing ? "Sincronizando..." : "Sincronizar"}</Button>
          <Button onClick={() => setNewPixelOpen(true)}>+ Pixel</Button>
        </div>
      </div>

      {feedback ? <Card className="border-primary/30 bg-primary/5"><CardContent className="p-3"><p className="text-sm text-foreground">{feedback}</p></CardContent></Card> : null}

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : pixels.length === 0 ? (
        <EmptyState title="Nenhum pixel ainda" description="Crie um pixel novo, ou clique em Sincronizar para importar pixels já existentes desta conta." />
      ) : (
        <ListCard
          ref={containerRef}
          availableHeight={availableHeight}
          footer={<TablePagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setCurrentPage} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead columnKey="name" sort={sort} onSort={onSort}>Pixel</SortableHead>
                <SortableHead columnKey="lastFiredTime" sort={sort} onSort={onSort}>Último disparo</SortableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Nenhum pixel nesta página.</TableCell></TableRow>
              ) : (
                paginatedItems.map((pixel) => (
                  <TableRow key={pixel.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{pixel.name}</p>
                        <p className="truncate text-xs text-muted-foreground">id {pixel.pixelId}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {pixel.lastFiredTime ? formatDateTime(pixel.lastFiredTime) : <span className="text-muted-foreground">— nunca disparou</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setViewingPixel(pixel)}>Ver eventos</Button>
                        <Button size="sm" onClick={() => setTestingPixel(pixel)}>Testar evento</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ListCard>
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

      <PixelEventsModal workspaceId={workspaceId} pixel={viewingPixel} onOpenChange={(open) => !open && setViewingPixel(undefined)} />
    </div>
  );
}

function PixelEventsModal({ workspaceId, pixel, onOpenChange }: { workspaceId: string; pixel: MetaPixel | undefined; onOpenChange: (open: boolean) => void }) {
  const { data, isLoading } = useMetaCapiEvents(workspaceId, pixel?.id);
  const events = data?.events ?? [];

  return (
    <DetailModal open={!!pixel} onOpenChange={onOpenChange} title={pixel?.name ?? ""} description="Eventos recentes enviados à Conversions API">
      <DetailBlock label="Eventos">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner className="h-5 w-5 text-primary" /></div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum evento enviado por este pixel ainda.</p>
        ) : (
          <div className="grid gap-2">
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={event.status === "sent" ? "font-medium text-foreground" : "font-medium text-destructive"}>{event.eventName}</span>
                  <span className="text-xs text-muted-foreground">{event.userDataFields.join(", ") || "sem user_data"}</span>
                  {event.testEventCode ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">teste</span> : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {event.status === "sent" ? `recebido (${event.eventsReceived ?? 0})` : (event.errorMessage ?? "falhou")} · {formatDateTime(event.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </DetailBlock>
    </DetailModal>
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
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={submitting} onClick={handleSubmit}>{submitting ? "Criando..." : "Criar pixel"}</Button>
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
        <p className="text-xs text-muted-foreground">
          E-mail/telefone são hasheados antes de sair do servidor — nunca trafegam nem ficam salvos em texto puro. Preencha o "Código de teste" (do painel Testar eventos do Events Manager) pra validar sem contaminar dados reais.
        </p>
        <div>
          <Label htmlFor="capi-event-name">Evento</Label>
          <Select value={eventName} onValueChange={setEventName}>
            <SelectTrigger id="capi-event-name"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EVENT_NAMES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
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
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {result ? (
          <p className="text-sm text-foreground">Enviado — {result.eventsReceived ?? 0} evento(s) recebido(s) pela Meta{result.fbtraceId ? ` (fbtrace ${result.fbtraceId})` : ""}.</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Fechar</Button>
          <Button type="button" disabled={submitting} onClick={handleSubmit}>{submitting ? "Enviando..." : "Enviar evento"}</Button>
        </div>
      </div>
    </Modal>
  );
}
