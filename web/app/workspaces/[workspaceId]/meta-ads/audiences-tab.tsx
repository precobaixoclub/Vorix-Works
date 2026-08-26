"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
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

export function AudiencesTab({ workspaceId, adAccount }: { workspaceId: string; adAccount: MetaAdAccount }) {
  const { data, isLoading, error, mutate } = useMetaCustomAudiences(workspaceId, adAccount.id);
  const audiences = data?.audiences ?? [];
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [newAudienceOpen, setNewAudienceOpen] = useState(false);
  const [lookalikeOrigin, setLookalikeOrigin] = useState<MetaCustomAudience | undefined>();

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
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Públicos customizados e semelhantes desta conta, mais busca de interesses pra segmentação.</p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={syncing} onClick={handleSync}>{syncing ? "Sincronizando..." : "Sincronizar"}</Button>
          <Button onClick={() => setNewAudienceOpen(true)}>+ Público</Button>
        </div>
      </div>

      {feedback ? <Card className="mb-4 border-accent/30 bg-accent-soft/30 p-3"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      <InterestSearch workspaceId={workspaceId} adAccount={adAccount} />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-accent" /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : audiences.length === 0 ? (
        <EmptyState title="Nenhum público ainda" description="Crie um público a partir de uma lista de clientes, ou clique em Sincronizar para importar públicos já existentes." />
      ) : (
        <div className="mt-4 grid gap-2">
          {audiences.map((audience) => (
            <Card key={audience.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-ink">{audience.name}</p>
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-muted">{audience.subtype}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {audience.approximateCount !== undefined ? `~${audience.approximateCount.toLocaleString("pt-BR")} pessoas` : "Tamanho ainda não calculado"}
                  {audience.subtype === "LOOKALIKE" && audience.lookalikeRatio !== undefined ? ` · ${(audience.lookalikeRatio * 100).toFixed(0)}% · ${audience.lookalikeCountry}` : ""}
                </p>
              </div>
              {audience.subtype !== "LOOKALIKE" && !audience.deletedAt ? (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setLookalikeOrigin(audience)}>+ Semelhante</Button>
              ) : null}
            </Card>
          ))}
        </div>
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
    <Card className="mb-4 p-3">
      <p className="mb-2 text-xs font-medium text-ink-muted">Buscar interesses (pra usar na segmentação de um conjunto de anúncios)</p>
      <div className="flex gap-2">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && handleSearch()} placeholder="Ex.: fitness, viagem, moda" />
        <Button variant="secondary" disabled={searching || query.trim().length < 2} onClick={handleSearch}>{searching ? "Buscando..." : "Buscar"}</Button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {results && results.length > 0 ? (
        <div className="mt-3 grid gap-1.5">
          {results.map((interest) => (
            <div key={interest.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-1.5 text-xs">
              <span className="text-ink">{interest.name}</span>
              <span className="text-ink-muted">{interest.audienceSize ? `~${interest.audienceSize.toLocaleString("pt-BR")}` : "—"} · id {interest.id}</span>
            </div>
          ))}
        </div>
      ) : results && results.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">Nenhum interesse encontrado.</p>
      ) : null}
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
        <p className="text-xs text-ink-muted">
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
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={handleSubmit}>{submitting ? "Criando..." : "Criar público"}</Button>
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
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={handleSubmit}>{submitting ? "Criando..." : "Criar público semelhante"}</Button>
        </div>
      </div>
    </Modal>
  );
}
