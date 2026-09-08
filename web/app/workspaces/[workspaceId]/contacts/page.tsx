"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createContact } from "@/features/crm/api";
import { useContactTimeline, useContacts } from "@/features/crm/hooks";
import type { TimelineEvent } from "@/features/crm/types";
import { useDebounce } from "@/hooks/useDebounce";

const EVENT_LABEL: Record<string, string> = {
  contact_created: "Contato criado",
  identity_linked: "Canal identificado",
};

function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">Nenhum evento ainda.</p>;
  return (
    <ol className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <p className="font-medium text-foreground">{EVENT_LABEL[event.eventType] ?? event.eventType}</p>
          <p className="text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleString("pt-BR")}</p>
        </li>
      ))}
    </ol>
  );
}

export default function ContactsPage() {
  const workspace = useCurrentWorkspace();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const { data: contacts, error, isLoading, mutate } = useContacts(workspace.id, { search: debouncedSearch || undefined });
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | undefined>();
  const { data: timeline } = useContactTimeline(selectedContactId, workspace.id);
  const selectedContact = contacts?.find((contact) => contact.id === selectedContactId);

  async function handleCreate() {
    setBusy(true);
    try {
      await createContact({ workspaceId: workspace.id, name: name.trim(), company: company.trim() || undefined });
      setCreateOpen(false);
      setName("");
      setCompany("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Contatos"
        description="A visão 360° de cada pessoa — de onde veio, quem é responsável, e o histórico completo."
        actions={<Button onClick={() => setCreateOpen(true)}>Novo contato</Button>}
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome" className="max-w-xs" />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <Card>
          <CardBody className="p-0">
            {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : null}
            {error ? <div className="p-5"><ErrorState error={error} onRetry={() => mutate()} /></div> : null}
            {!isLoading && !error && contacts && contacts.length === 0 ? (
              <div className="p-5"><EmptyState title="Nenhum contato ainda" description={search ? "Nenhum contato encontrado para essa busca." : "Contatos aparecem aqui conforme chegam por WhatsApp/Instagram ou são criados manualmente."} /></div>
            ) : null}
            {contacts && contacts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Última interação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => (
                    <TableRow key={contact.id} className={selectedContactId === contact.id ? "bg-primary/5" : undefined} onClick={() => setSelectedContactId(contact.id)} style={{ cursor: "pointer" }}>
                      <TableCell className="font-medium text-foreground">{contact.name}</TableCell>
                      <TableCell className="text-muted-foreground">{contact.company ?? "—"}</TableCell>
                      <TableCell>{contact.origin ? <Badge variant="secondary">{contact.origin}</Badge> : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{contact.lastInteractionAt ? new Date(contact.lastInteractionAt).toLocaleDateString("pt-BR") : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">{selectedContact ? selectedContact.name : "Timeline"}</p></CardHeader>
          <CardBody>
            {!selectedContact ? (
              <p className="text-sm text-muted-foreground">Selecione um contato pra ver o histórico completo.</p>
            ) : (
              <TimelineList events={timeline ?? []} />
            )}
          </CardBody>
        </Card>
      </div>

      {createOpen ? (
        <Modal title="Novo contato" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="contact-name">Nome</Label>
              <Input id="contact-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do contato" />
            </div>
            <div>
              <Label htmlFor="contact-company">Empresa (opcional)</Label>
              <Input id="contact-company" value={company} onChange={(event) => setCompany(event.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={handleCreate} loading={busy} disabled={!name.trim() || busy}>Criar</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
