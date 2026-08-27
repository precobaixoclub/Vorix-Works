"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { ListCard } from "@/components/ListCard";
import { Modal } from "@/components/Modal";
import { SortableHead } from "@/components/SortableHead";
import { Spinner } from "@/components/Spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useSortedRows } from "@/hooks/useSortedRows";
import { createMetaCustomAudience, createMetaLookalikeAudience, searchMetaAdInterests, syncMetaCustomAudiences } from "@/features/meta-ads/api";
import { useMetaCustomAudiences } from "@/features/meta-ads/hooks";
import type { MetaAdAccount, MetaAdInterest, MetaCustomAudience } from "@/features/meta-ads/types";

function parseCustomersFromText(text: string): { email?: string; phone?: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [email, phone] = line.split(",").map((part) => part.trim());
      return { email: email || undefined, phone: phone || undefined };
    });
}

type AudienceSortKey = "name" | "subtype" | "approximateCount";

export function AudiencesTab({ workspaceId, adAccount }: { workspaceId: string; adAccount: MetaAdAccount }) {
  const { data, isLoading, error, mutate } = useMetaCustomAudiences(workspaceId, adAccount.id);
  const audiences = data?.audiences ?? [];
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [newAudienceOpen, setNewAudienceOpen] = useState(false);
  const [lookalikeOrigin, setLookalikeOrigin] = useState<MetaCustomAudience | undefined>();

  const { sorted, sort, onSort } = useSortedRows<MetaCustomAudience, AudienceSortKey>(
    audiences,
    { name: (audience) => audience.name.toLowerCase(), subtype: (audience) => audience.subtype, approximateCount: (audience) => audience.approximateCount ?? null },
    { key: "name", dir: "asc" },
  );
  const { currentPage, totalPages, paginatedItems, setCurrentPage, resetPage, totalItems, pageSize, containerRef, availableHeight } = usePagination(sorted, { auto: true });
  useEffect(() => { resetPage(); }, [sort, resetPage]);

  async function handleSync() {
    setSyncing(true);
    setFeedback(undefined);
    try {
      const result = await syncMetaCustomAudiences(workspaceId, adAccount.id);
      await mutate();
      setFeedback(`Sincronizado: ${result.audiencesSynced} público(s).`);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Não foi possível sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Públicos customizados e semelhantes desta conta, mais busca de interesses pra segmentação.</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={syncing} onClick={handleSync}>{syncing ? "Sincronizando..." : "Sincronizar"}</Button>
          <Button onClick={() => setNewAudienceOpen(true)}>+ Público</Button>
        </div>
      </div>

      {feedback ? <Card className="border-primary/30 bg-primary/5"><CardContent className="p-3"><p className="text-sm text-foreground">{feedback}</p></CardContent></Card> : null}

      <InterestSearch workspaceId={workspaceId} adAccount={adAccount} />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : audiences.length === 0 ? (
        <EmptyState title="Nenhum público ainda" description="Crie um público a partir de uma lista de clientes, ou clique em Sincronizar para importar públicos já existentes." />
      ) : (
        <ListCard
          ref={containerRef}
          availableHeight={availableHeight}
          footer={<TablePagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setCurrentPage} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead columnKey="name" sort={sort} onSort={onSort}>Público</SortableHead>
                <SortableHead columnKey="subtype" sort={sort} onSort={onSort}>Tipo</SortableHead>
                <SortableHead columnKey="approximateCount" sort={sort} onSort={onSort} align="right">Tamanho</SortableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Nenhum público nesta página.</TableCell></TableRow>
              ) : (
                paginatedItems.map((audience) => (
                  <TableRow key={audience.id}>
                    <TableCell className="font-medium text-foreground">{audience.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {audience.subtype}
                      {audience.subtype === "LOOKALIKE" && audience.lookalikeRatio !== undefined ? ` · ${(audience.lookalikeRatio * 100).toFixed(0)}% · ${audience.lookalikeCountry}` : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {audience.approximateCount !== undefined ? `~${audience.approximateCount.toLocaleString("pt-BR")}` : "—"}
                    </TableCell>
                    <TableCell>
                      {audience.subtype !== "LOOKALIKE" && !audience.deletedAt ? (
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setLookalikeOrigin(audience)}>+ Semelhante</Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ListCard>
      )}

      {newAudienceOpen ? (
        <NewCustomAudienceModal
          workspaceId={workspaceId}
          adAccount={adAccount}
          onClose={() => setNewAudienceOpen(false)}
          onCreated={async (usersUploaded) => {
            setNewAudienceOpen(false);
            await mutate();
            setFeedback(usersUploaded > 0 ? `Público criado — ${usersUploaded} contato(s) enviado(s) (hash, nunca dado cru).` : "Público criado — vazio, pronto pra receber contatos depois.");
          }}
        />
      ) : null}

      {lookalikeOrigin ? (
        <NewLookalikeModal
          workspaceId={workspaceId}
          origin={lookalikeOrigin}
          onClose={() => setLookalikeOrigin(undefined)}
          onCreated={async () => {
            setLookalikeOrigin(undefined);
            await mutate();
            setFeedback("Público semelhante criado.");
          }}
        />
      ) : null}
    </div>
  );
}

function InterestSearch({ workspaceId, adAccount }: { workspaceId: string; adAccount: MetaAdAccount }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MetaAdInterest[] | undefined>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSearch() {
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(undefined);
    try {
      const { interests } = await searchMetaAdInterests(workspaceId, adAccount.credentialReferenceId, query);
      setResults(interests);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível buscar interesses.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Buscar interesses (pra usar na segmentação de um conjunto de anúncios)</p>
        <div className="flex gap-2">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && handleSearch()} placeholder="Ex.: fitness, viagem, moda" />
          <Button variant="outline" disabled={searching || query.trim().length < 2} onClick={handleSearch}>{searching ? "Buscando..." : "Buscar"}</Button>
        </div>
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        {results && results.length > 0 ? (
          <div className="mt-3 grid gap-1.5">
            {results.map((interest) => (
              <div key={interest.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs">
                <span className="text-foreground">{interest.name}</span>
                <span className="text-muted-foreground">{interest.audienceSize ? `~${interest.audienceSize.toLocaleString("pt-BR")}` : "—"} · id {interest.id}</span>
              </div>
            ))}
          </div>
        ) : results && results.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Nenhum interesse encontrado.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NewCustomAudienceModal({ workspaceId, adAccount, onClose, onCreated }: { workspaceId: string; adAccount: MetaAdAccount; onClose: () => void; onCreated: (usersUploaded: number) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [customersText, setCustomersText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Dê um nome pro público.");
      return;
    }
    const customers = parseCustomersFromText(customersText);
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await createMetaCustomAudience(workspaceId, { adAccountId: adAccount.id, name: name.trim(), description: description || undefined, customers: customers.length > 0 ? customers : undefined });
      onCreated(result.usersUploaded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o público.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Novo público (lista de clientes)" onClose={onClose} maxWidthClass="sm:max-w-lg">
      <div className="grid gap-4">
        <p className="text-xs text-muted-foreground">
          E-mail e telefone são hasheados (SHA-256) no seu navegador antes de sair pra Meta — o dado cru nunca é salvo. Todos os contatos precisam ter os mesmos campos preenchidos (só e-mail, só telefone, ou os dois).
        </p>
        <div>
          <Label htmlFor="audience-name">Nome</Label>
          <Input id="audience-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Clientes últimos 90 dias" autoFocus />
        </div>
        <div>
          <Label htmlFor="audience-description">Descrição (opcional)</Label>
          <Input id="audience-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="audience-customers">Contatos (opcional — um por linha, "e-mail,telefone")</Label>
          <Textarea id="audience-customers" rows={6} value={customersText} onChange={(event) => setCustomersText(event.target.value)} placeholder={"maria@exemplo.com,11999998888\njoao@exemplo.com,11888887777"} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={submitting} onClick={handleSubmit}>{submitting ? "Criando..." : "Criar público"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function NewLookalikeModal({ workspaceId, origin, onClose, onCreated }: { workspaceId: string; origin: MetaCustomAudience; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(`${origin.name} — Semelhante 1%`);
  const [ratio, setRatio] = useState("1");
  const [country, setCountry] = useState("BR");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    const ratioValue = Number(ratio) / 100;
    if (!name.trim()) {
      setError("Dê um nome pro público semelhante.");
      return;
    }
    if (ratioValue < 0.01 || ratioValue > 0.2) {
      setError("A proporção precisa estar entre 1% e 20%.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await createMetaLookalikeAudience(workspaceId, { originAudienceId: origin.id, name: name.trim(), ratio: ratioValue, country: country.trim().toUpperCase() });
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o público semelhante.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Público semelhante a "${origin.name}"`} onClose={onClose}>
      <div className="grid gap-4">
        <div>
          <Label htmlFor="lookalike-name">Nome</Label>
          <Input id="lookalike-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="lookalike-ratio">Proporção (1% a 20%)</Label>
            <Input id="lookalike-ratio" type="number" min={1} max={20} value={ratio} onChange={(event) => setRatio(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="lookalike-country">País</Label>
            <Input id="lookalike-country" value={country} onChange={(event) => setCountry(event.target.value)} placeholder="BR" />
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={submitting} onClick={handleSubmit}>{submitting ? "Criando..." : "Criar público semelhante"}</Button>
        </div>
      </div>
    </Modal>
  );
}
