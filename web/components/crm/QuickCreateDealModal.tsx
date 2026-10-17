"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { TeamPicker } from "@/components/TeamPicker";
import { UserPicker } from "@/components/UserPicker";
import { ProductLinesEditor, draftPrice, draftQuantity, type DraftLine } from "@/components/sales/ProductLinesEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createDeal } from "@/features/crm/api";
import { useContacts, usePipelines, usePipelineStages, useProducts } from "@/features/crm/hooks";
import { centsFromCurrencyInput } from "@/features/crm/presentation";
import type { Deal } from "@/features/crm/types";
import { addDealItem, findDuplicateDeals } from "@/features/sales/api";
import { useCommercialSettings } from "@/features/sales/hooks";
import { formatCurrencyCents } from "@/lib/format";

/**
 * Criar oportunidade (Sales Engine). Título → produtos e serviços (com prévia de tabela, desconto,
 * valor proposto e margem quando permitido) → pipeline/etapa/responsável/equipe/previsão. Produtos
 * nunca ficam escondidos em "opções avançadas"; sem produtos, vale o valor estimado manual.
 * O backend recalcula e valida tudo (inclusive política comercial) ao salvar.
 */
export function QuickCreateDealModal({
  workspaceId,
  contactId,
  defaultOrigin,
  defaultOwnerUserId,
  defaultTeamId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  /** Ausente = o usuário escolhe o contato no próprio formulário (tela de Oportunidades). */
  contactId?: string;
  defaultOrigin?: string;
  defaultOwnerUserId?: string;
  defaultTeamId?: string;
  onClose: () => void;
  onCreated: (deal: Deal) => void | Promise<void>;
}) {
  const { data: pipelines } = usePipelines(workspaceId);
  const { data: products } = useProducts(workspaceId, { activeOnly: true });
  const { data: settings } = useCommercialSettings(workspaceId);
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  useEffect(() => {
    if (!pipelineId && pipelines && pipelines.length > 0) setPipelineId((pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0]).id);
  }, [pipelines, pipelineId]);

  const { data: stages } = usePipelineStages(pipelineId, workspaceId);
  const openStages = [...(stages ?? [])].filter((stage) => !stage.isWon && !stage.isLost).sort((a, b) => a.position - b.position);
  const [stageId, setStageId] = useState<string | undefined>();
  useEffect(() => {
    if (openStages.length > 0 && !openStages.some((stage) => stage.id === stageId)) setStageId(openStages[0].id);
  }, [openStages, stageId]);

  const [title, setTitle] = useState("");
  const [selectedContactId, setSelectedContactId] = useState(contactId ?? "");
  const [origin, setOrigin] = useState(defaultOrigin ?? "");
  const { data: contacts } = useContacts(workspaceId);
  const effectiveContactId = contactId ?? (selectedContactId || undefined);
  const [valueReais, setValueReais] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [ownerUserId, setOwnerUserId] = useState(defaultOwnerUserId ?? "");
  const [teamId, setTeamId] = useState(defaultTeamId ?? "");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [duplicates, setDuplicates] = useState<{ id: string; title: string; valueCents: number; currency: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Aviso de duplicidade (nunca bloqueia): mesmo contato no mesmo pipeline ou mesmo título.
  useEffect(() => {
    if (!pipelineId) return;
    const handle = setTimeout(() => {
      findDuplicateDeals(workspaceId, { pipelineId, title: title.trim(), contactId: effectiveContactId }).then(setDuplicates).catch(() => setDuplicates([]));
    }, 400);
    return () => clearTimeout(handle);
  }, [workspaceId, pipelineId, title, effectiveContactId]);

  async function handleSubmit() {
    if (!pipelineId || !stageId || !title.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const deal = await createDeal({
        workspaceId,
        pipelineId,
        stageId,
        contactId: effectiveContactId,
        title: title.trim(),
        valueCents: lines.length ? 0 : centsFromCurrencyInput(valueReais),
        origin: origin.trim() || undefined,
        ownerUserId: ownerUserId || undefined,
        teamId: teamId || undefined,
        expectedCloseDate: expectedCloseDate || undefined,
      });
      const failures: string[] = [];
      for (const line of lines) {
        try {
          await addDealItem(deal.id, { workspaceId, productId: line.productId, quantity: draftQuantity(line), proposedUnitPriceCents: draftPrice(line) });
        } catch (cause) {
          failures.push(`${line.name}: ${cause instanceof Error ? cause.message : "erro"}`);
        }
      }
      if (failures.length) toast.error("Oportunidade criada, mas alguns produtos não entraram", { description: failures.join(" · ") });
      await onCreated(deal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a oportunidade.");
    } finally {
      setBusy(false);
    }
  }

  const showMargin = settings?.visibility.canViewMargin ?? false;

  return (
    <Modal title="Criar oportunidade" onClose={onClose} maxWidthClass="sm:max-w-2xl">
      <div className="space-y-4">
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        <div>
          <Label htmlFor="quick-deal-title">Título</Label>
          <Input id="quick-deal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Plano Premium" autoFocus />
        </div>

        {contactId ? null : (
          <div>
            <Label>Contato</Label>
            <SearchableCombo items={(contacts ?? []).map((contact) => ({ id: contact.id, label: contact.company ? `${contact.name} · ${contact.company}` : contact.name }))} value={selectedContactId} onValueChange={setSelectedContactId} placeholder="Selecionar contato" searchPlaceholder="Buscar contato..." extraOption={{ value: "", label: "Sem contato" }} />
          </div>
        )}

        {duplicates.length > 0 ? (
          <div className="flex gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Já existe oportunidade aberta parecida:</p>
              <ul className="mt-0.5 list-disc pl-4">{duplicates.map((deal) => <li key={deal.id}>{deal.title} · {formatCurrencyCents(deal.valueCents, deal.currency)}</li>)}</ul>
              <p className="mt-0.5">Você pode criar mesmo assim.</p>
            </div>
          </div>
        ) : null}

        <div>
          <Label>Produtos e serviços</Label>
          <ProductLinesEditor products={products ?? []} lines={lines} onChange={setLines} showMargin={showMargin} />
          {lines.length === 0 ? (
            <div className="mt-3">
              <Label htmlFor="quick-deal-value">Valor estimado (R$) — sem produtos</Label>
              <Input id="quick-deal-value" value={valueReais} onChange={(event) => setValueReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
          ) : <p className="mt-1 text-[11px] text-muted-foreground">Com produtos, o valor da oportunidade é calculado automaticamente.</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Pipeline</Label>
            <Select value={pipelineId} onValueChange={(value) => { setPipelineId(value); setStageId(undefined); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(pipelines ?? []).map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Etapa</Label>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{openStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Responsável</Label>
            <UserPicker workspaceId={workspaceId} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "", label: "Sem responsável" }} />
          </div>
          <div>
            <Label>Equipe</Label>
            <TeamPicker workspaceId={workspaceId} value={teamId} onValueChange={setTeamId} extraOption={{ value: "", label: "Sem equipe" }} />
          </div>
          <div>
            <Label htmlFor="quick-deal-origin">Origem</Label>
            <Input id="quick-deal-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="Ex.: whatsapp, indicação" />
          </div>
          <div>
            <Label htmlFor="quick-deal-close">Previsão de fechamento</Label>
            <Input id="quick-deal-close" type="date" value={expectedCloseDate} onChange={(event) => setExpectedCloseDate(event.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={handleSubmit} loading={busy} disabled={!title.trim() || !pipelineId || !stageId || busy}>Criar oportunidade</Button>
        </div>
      </div>
    </Modal>
  );
}
