"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Card, CardBody } from "@/components/Card";
import { DetailBlock } from "@/components/DetailModal";
import { Input, Label, Textarea } from "@/components/Field";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { FunnelStagesBlock } from "@/components/sales/FunnelStagesBlock";
import { Spinner } from "@/components/Spinner";
import { TeamPicker } from "@/components/TeamPicker";
import { UserPicker, userLabel } from "@/components/UserPicker";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useInboxMembers } from "@/features/inbox/hooks";
import { useProducts } from "@/features/crm/hooks";
import { centsFromCurrencyInput } from "@/features/crm/presentation";
import {
  createCompetitor,
  createCustomField,
  createPriceBook,
  createReason,
  deletePolicy,
  deletePriceBookItem,
  updateCommercialSettings,
  updateCompetitor,
  updateCustomField,
  updatePriceBook,
  updateReason,
  upsertPolicy,
  upsertPriceBookItem,
} from "@/features/sales/api";
import { useCommercialSettings, useCompetitors, useCustomFields, usePolicies, usePriceBookItems, usePriceBooks, useReasons } from "@/features/sales/hooks";
import { bpFromPercentInput, formatBp, percentInputFromBp } from "@/features/sales/presentation";
import type { CloseReasonKind, CommercialPolicy, CustomFieldType } from "@/features/sales/types";
import { formatCurrencyCents } from "@/lib/format";

const toastError = (title: string) => (cause: unknown) => toast.error(title, { description: cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : undefined });

/** Configuração comercial do Vorix Conversas — tudo o que é regra da empresa (nunca hardcoded). */
export default function CommercialSettingsPage() {
  const workspace = useCurrentWorkspace();
  const { data: settings, isLoading, mutate } = useCommercialSettings(workspace.id);
  const isManager = settings?.visibility.isManager ?? false;

  return (
    <SettingsShell active="commercial" title="Regras comerciais" description="Visibilidade de custo e margem, autonomia de desconto, aprovações, mensagens e motivos.">
      {isLoading || !settings ? <div className="flex justify-center py-14"><Spinner /></div> : (
        <Card>
          <CardBody className="space-y-9">
            {!isManager ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">Somente gestores (admin/owner) alteram estas regras.</p> : null}
            <GeneralBlock workspaceId={workspace.id} settings={settings} disabled={!isManager} onSaved={() => mutate()} />
            <PoliciesBlock workspaceId={workspace.id} disabled={!isManager} />
            <TemplatesBlock workspaceId={workspace.id} settings={settings} disabled={!isManager} onSaved={() => mutate()} />
            <ReasonsBlock workspaceId={workspace.id} disabled={!isManager} />
            <CustomFieldsBlock workspaceId={workspace.id} disabled={!isManager} />
            <FunnelStagesBlock workspaceId={workspace.id} disabled={!isManager} />
            <PriceBooksBlock workspaceId={workspace.id} disabled={!isManager} />
          </CardBody>
        </Card>
      )}
    </SettingsShell>
  );
}

function ToggleRow({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div><p className="text-sm font-medium text-foreground">{label}</p><p className="text-xs text-muted-foreground">{description}</p></div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function GeneralBlock({ workspaceId, settings, disabled, onSaved }: { workspaceId: string; settings: NonNullable<ReturnType<typeof useCommercialSettings>["data"]>; disabled: boolean; onSaved: () => void }) {
  const save = (patch: Parameters<typeof updateCommercialSettings>[0]) => updateCommercialSettings(patch).then(onSaved).catch(toastError("Não foi possível salvar"));
  const [months, setMonths] = useState(settings.defaultContractMonths ? String(settings.defaultContractMonths) : "");
  return (
    <DetailBlock label="Visibilidade e fechamento">
      <div className="divide-y divide-border/60">
        <ToggleRow label="Vendedores veem o custo" description="Admin e owner sempre veem. Desligado, o custo nunca sai do servidor para vendedores." checked={settings.sellersCanViewCost} disabled={disabled} onChange={(value) => void save({ workspaceId, sellersCanViewCost: value })} />
        <ToggleRow label="Vendedores veem margem e lucro" description="Mostra margem atual e mínima na negociação. O espaço até o preço mínimo é sempre visível." checked={settings.sellersCanViewMargin} disabled={disabled} onChange={(value) => void save({ workspaceId, sellersCanViewMargin: value })} />
        <ToggleRow label="Aceite da proposta marca a venda como ganha" description="Desligado (recomendado): o aceite só sinaliza; o vendedor finaliza a oportunidade." checked={settings.proposalAcceptAutoWin} disabled={disabled} onChange={(value) => void save({ workspaceId, proposalAcceptAutoWin: value })} />
        <ToggleRow label="Ranking de vendedores" description="Exibe a classificação na visão da equipe. Não é gamificação obrigatória." checked={settings.rankingEnabled} disabled={disabled} onChange={(value) => void save({ workspaceId, rankingEnabled: value })} />
        <div className="grid gap-3 py-3 sm:grid-cols-2">
          <div>
            <Label>Quem vê quais oportunidades</Label>
            <Select value={settings.dealVisibility} disabled={disabled} onValueChange={(value) => void save({ workspaceId, dealVisibility: value as "all" | "team" | "own" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos veem todas</SelectItem>
                <SelectItem value="team">Vendedor vê as suas e as da equipe</SelectItem>
                <SelectItem value="own">Vendedor vê só as suas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="default-contract">Contrato padrão p/ TCV (meses)</Label>
            <Input id="default-contract" value={months} disabled={disabled} placeholder="Sem padrão (anualiza)" onChange={(event) => setMonths(event.target.value.replace(/\D/g, ""))} onBlur={() => void save({ workspaceId, defaultContractMonths: months ? Number(months) : null })} inputMode="numeric" />
          </div>
        </div>
      </div>
    </DetailBlock>
  );
}

function PoliciesBlock({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const { data: policies, mutate } = usePolicies(workspaceId);
  const { data: memberData } = useInboxMembers(workspaceId);
  const members = memberData?.members;
  const [scopeType, setScopeType] = useState<CommercialPolicy["scopeType"]>("workspace");
  const [scopeId, setScopeId] = useState("");
  const [minMargin, setMinMargin] = useState("");
  const [maxDiscount, setMaxDiscount] = useState("");
  const [allowBelow, setAllowBelow] = useState(false);
  const [removing, setRemoving] = useState<CommercialPolicy>();
  const scopeLabel = (policy: CommercialPolicy) => policy.scopeType === "workspace" ? "Empresa (padrão)" : policy.scopeType === "role" ? `Papel: ${({ owner: "Owner", admin: "Admin/Gestor", editor: "Vendedor", viewer: "Leitura" } as Record<string, string>)[policy.scopeId ?? ""] ?? policy.scopeId}` : policy.scopeType === "user" ? `Vendedor: ${userLabel(policy.scopeId, members)}` : `Equipe: ${policy.scopeId}`;
  return (
    <DetailBlock label="Autonomia comercial (aprovação)">
      <p className="mb-3 text-xs text-muted-foreground">Quando o preço fica abaixo do mínimo, a margem abaixo da mínima ou o desconto acima do máximo, a proposta só é enviada após aprovação de um gestor. A regra mais específica vale: vendedor &gt; equipe &gt; papel &gt; empresa.</p>
      <div className="mb-3 space-y-1.5">
        {(policies ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma política — só o preço mínimo dos produtos exige aprovação.</p> : null}
        {(policies ?? []).map((policy) => (
          <div key={policy.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
            <span>{scopeLabel(policy)}</span>
            <span className="flex items-center gap-3 text-muted-foreground">
              margem mín. {formatBp(policy.minMarginBp)} · desconto máx. {formatBp(policy.maxDiscountBp)}{policy.allowBelowMinimum ? " · pode abaixo do mínimo" : ""}
              {!disabled ? <Button variant="ghost" size="icon" aria-label="Remover política" onClick={() => setRemoving(policy)}><Trash2 className="h-4 w-4" /></Button> : null}
            </span>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remover regra de autonomia?"
        description={removing ? `A regra "${scopeLabel(removing)}" deixa de valer imediatamente; passa a valer a regra mais geral.` : ""}
        confirmLabel="Remover"
        variant="danger"
        onCancel={() => setRemoving(undefined)}
        onConfirm={async () => { try { await deletePolicy(removing!.id, workspaceId); await mutate(); } catch (cause) { toastError("Não foi possível remover")(cause); } finally { setRemoving(undefined); } }}
      />
      {!disabled ? (
        <div className="grid gap-2 rounded-xl bg-muted/40 p-3 sm:grid-cols-5">
          <div className="sm:col-span-2">
            <Label>Aplica a</Label>
            <Select value={scopeType} onValueChange={(value) => { setScopeType(value as CommercialPolicy["scopeType"]); setScopeId(value === "role" ? "editor" : ""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">Empresa (padrão)</SelectItem>
                <SelectItem value="role">Papel</SelectItem>
                <SelectItem value="team">Equipe</SelectItem>
                <SelectItem value="user">Vendedor</SelectItem>
              </SelectContent>
            </Select>
            {scopeType === "role" ? (
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="editor">Vendedor (editor)</SelectItem><SelectItem value="admin">Gestor (admin)</SelectItem></SelectContent>
              </Select>
            ) : scopeType === "user" ? <div className="mt-1"><UserPicker workspaceId={workspaceId} value={scopeId} onValueChange={setScopeId} /></div> : scopeType === "team" ? <div className="mt-1"><TeamPicker workspaceId={workspaceId} value={scopeId} onValueChange={setScopeId} /></div> : null}
          </div>
          <div><Label htmlFor="pol-margin">Margem mín. %</Label><Input id="pol-margin" value={minMargin} onChange={(event) => setMinMargin(event.target.value)} placeholder="Ex.: 40" inputMode="decimal" /></div>
          <div><Label htmlFor="pol-discount">Desconto máx. %</Label><Input id="pol-discount" value={maxDiscount} onChange={(event) => setMaxDiscount(event.target.value)} placeholder="Ex.: 10" inputMode="decimal" /></div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-xs"><Switch checked={allowBelow} onCheckedChange={setAllowBelow} />Pode abaixo do mínimo</label>
            <Button
              size="sm"
              disabled={scopeType !== "workspace" && !scopeId}
              onClick={() => upsertPolicy({ workspaceId, scopeType, scopeId: scopeType === "workspace" ? undefined : scopeId, minMarginBp: bpFromPercentInput(minMargin) ?? null, maxDiscountBp: bpFromPercentInput(maxDiscount) ?? null, allowBelowMinimum: allowBelow })
                .then(() => { setMinMargin(""); setMaxDiscount(""); setAllowBelow(false); return mutate(); })
                .catch(toastError("Não foi possível salvar a política"))}
            >
              Salvar regra
            </Button>
          </div>
        </div>
      ) : null}
    </DetailBlock>
  );
}

function TemplatesBlock({ workspaceId, settings, disabled, onSaved }: { workspaceId: string; settings: NonNullable<ReturnType<typeof useCommercialSettings>["data"]>; disabled: boolean; onSaved: () => void }) {
  const [send, setSend] = useState(settings.proposalWhatsappTemplate ?? "");
  const [reminder, setReminder] = useState(settings.proposalReminderTemplate ?? "");
  useEffect(() => { setSend(settings.proposalWhatsappTemplate ?? ""); setReminder(settings.proposalReminderTemplate ?? ""); }, [settings.proposalWhatsappTemplate, settings.proposalReminderTemplate]);
  return (
    <DetailBlock label="Mensagens da proposta no WhatsApp">
      <p className="mb-2 text-xs text-muted-foreground">Variáveis: {"{{nome}}"}, {"{{valor}}"}, {"{{validade}}"}, {"{{numero}}"} e {"{{proposal_link}}"} (obrigatório no envio). Vazio = mensagem padrão.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="tpl-send">Envio da proposta</Label><Textarea id="tpl-send" rows={6} value={send} disabled={disabled} onChange={(event) => setSend(event.target.value)} placeholder={"Olá, {{nome}}!\n\nSua proposta comercial está disponível.\nValor: {{valor}}\nValidade: {{validade}}\n\n{{proposal_link}}"} /></div>
        <div><Label htmlFor="tpl-remind">Lembrete</Label><Textarea id="tpl-remind" rows={6} value={reminder} disabled={disabled} onChange={(event) => setReminder(event.target.value)} placeholder={"Olá, {{nome}}! Passando para lembrar da proposta ({{valor}}).\n\n{{proposal_link}}"} /></div>
      </div>
      {!disabled ? <Button size="sm" className="mt-2" onClick={() => updateCommercialSettings({ workspaceId, proposalWhatsappTemplate: send.trim() || null, proposalReminderTemplate: reminder.trim() || null }).then(() => { onSaved(); toast.success("Mensagens salvas."); }).catch(toastError("Não foi possível salvar"))}>Salvar mensagens</Button> : null}
    </DetailBlock>
  );
}

const REASON_KIND_LABEL: Record<CloseReasonKind, string> = { lost: "Motivos de perda", won: "Motivos de ganho", proposal_decline: "Motivos de recusa da proposta (cliente)" };

function ReasonsBlock({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const { data: reasons, mutate } = useReasons(workspaceId, undefined, true);
  const { data: competitors, mutate: mutateCompetitors } = useCompetitors(workspaceId, true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [competitor, setCompetitor] = useState("");
  return (
    <DetailBlock label="Motivos e concorrentes">
      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(REASON_KIND_LABEL) as CloseReasonKind[]).map((kind) => (
          <div key={kind}>
            <p className="mb-1.5 text-sm font-medium">{REASON_KIND_LABEL[kind]}</p>
            <div className="flex flex-wrap gap-1.5">
              {(reasons ?? []).filter((reason) => reason.kind === kind).map((reason) => (
                <button key={reason.id} type="button" disabled={disabled} onClick={() => updateReason(reason.id, { workspaceId, active: !reason.active }).then(() => mutate()).catch(toastError("Não foi possível alterar"))} className={reason.active ? "rounded-full border border-border px-2.5 py-1 text-xs" : "rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground line-through"} title={reason.active ? "Clique para desativar" : "Clique para reativar"}>{reason.label}</button>
              ))}
            </div>
            {!disabled ? (
              <div className="mt-2 flex gap-2">
                <Input value={drafts[kind] ?? ""} onChange={(event) => setDrafts({ ...drafts, [kind]: event.target.value })} placeholder="Novo motivo" />
                <Button variant="secondary" size="sm" disabled={!drafts[kind]?.trim()} onClick={() => createReason({ workspaceId, kind, label: drafts[kind].trim() }).then(() => { setDrafts({ ...drafts, [kind]: "" }); return mutate(); }).catch(toastError("Não foi possível criar"))}>Adicionar</Button>
              </div>
            ) : null}
          </div>
        ))}
        <div>
          <p className="mb-1.5 text-sm font-medium">Concorrentes</p>
          <div className="flex flex-wrap gap-1.5">
            {(competitors ?? []).map((item) => (
              <button key={item.id} type="button" disabled={disabled} onClick={() => updateCompetitor(item.id, { workspaceId, active: !item.active }).then(() => mutateCompetitors()).catch(toastError("Não foi possível alterar"))} className={item.active ? "rounded-full border border-border px-2.5 py-1 text-xs" : "rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground line-through"}>{item.name}</button>
            ))}
            {(competitors ?? []).length === 0 ? <span className="text-xs text-muted-foreground">Nenhum — também são criados ao marcar uma perda.</span> : null}
          </div>
          <div className="mt-2 flex gap-2">
            <Input value={competitor} onChange={(event) => setCompetitor(event.target.value)} placeholder="Nome do concorrente" />
            <Button variant="secondary" size="sm" disabled={!competitor.trim()} onClick={() => createCompetitor({ workspaceId, name: competitor.trim() }).then(() => { setCompetitor(""); return mutateCompetitors(); }).catch(toastError("Não foi possível criar"))}>Adicionar</Button>
          </div>
        </div>
      </div>
    </DetailBlock>
  );
}

const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = { text: "Texto", number: "Número", currency: "Moeda", date: "Data", select: "Seleção", multi_select: "Múltipla seleção", boolean: "Sim/Não" };

function CustomFieldsBlock({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const { data: fields, mutate } = useCustomFields(workspaceId, true);
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const key = label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40);
  return (
    <DetailBlock label="Campos personalizados da oportunidade">
      <p className="mb-2 text-xs text-muted-foreground">Use em etapas do funil como campos obrigatórios (ex.: decisor, orçamento) — configure em Oportunidades › etapas.</p>
      <div className="mb-3 space-y-1.5">
        {(fields ?? []).map((field) => (
          <div key={field.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
            <span>{field.label} <span className="text-xs text-muted-foreground">· {FIELD_TYPE_LABEL[field.fieldType]} · custom:{field.key}</span></span>
            {!disabled ? <Switch checked={field.active} onCheckedChange={(active) => updateCustomField(field.id, { workspaceId, active }).then(() => mutate()).catch(toastError("Não foi possível alterar"))} /> : null}
          </div>
        ))}
      </div>
      {!disabled ? (
        <div className="grid gap-2 rounded-xl bg-muted/40 p-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><Label htmlFor="cf-label">Nome do campo</Label><Input id="cf-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Orçamento aprovado" /></div>
          <div>
            <Label>Tipo</Label>
            <Select value={fieldType} onValueChange={(value) => setFieldType(value as CustomFieldType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(FIELD_TYPE_LABEL) as CustomFieldType[]).map((type) => <SelectItem key={type} value={type}>{FIELD_TYPE_LABEL[type]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-end"><Button size="sm" className="w-full" disabled={!key || ((fieldType === "select" || fieldType === "multi_select") && !options.trim())} onClick={() => createCustomField({ workspaceId, key, label: label.trim(), fieldType, options: options.split(",").map((option) => option.trim()).filter(Boolean) }).then(() => { setLabel(""); setOptions(""); return mutate(); }).catch(toastError("Não foi possível criar o campo"))}>Criar campo</Button></div>
          {fieldType === "select" || fieldType === "multi_select" ? <div className="sm:col-span-4"><Label htmlFor="cf-options">Opções (separadas por vírgula)</Label><Input id="cf-options" value={options} onChange={(event) => setOptions(event.target.value)} /></div> : null}
        </div>
      ) : null}
    </DetailBlock>
  );
}

function PriceBooksBlock({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const { data: books, mutate } = usePriceBooks(workspaceId);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>();
  return (
    <DetailBlock label="Tabelas de preço (opcional)">
      <p className="mb-2 text-xs text-muted-foreground">Ex.: parceiros, enterprise, região Sul. Sem tabela, vale o preço de tabela do produto.</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {(books ?? []).map((book) => (
          <button key={book.id} type="button" onClick={() => setSelected(selected === book.id ? undefined : book.id)} className={selected === book.id ? "rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs" : "rounded-full border border-border px-3 py-1 text-xs"}>{book.name}{book.active ? "" : " (inativa)"}</button>
        ))}
      </div>
      {!disabled ? (
        <div className="flex gap-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nova tabela" className="max-w-xs" />
          <Button variant="secondary" size="sm" disabled={!name.trim()} onClick={() => createPriceBook({ workspaceId, name: name.trim() }).then(() => { setName(""); return mutate(); }).catch(toastError("Não foi possível criar"))}>Criar tabela</Button>
        </div>
      ) : null}
      {selected ? <PriceBookItems workspaceId={workspaceId} priceBookId={selected} disabled={disabled} onToggleActive={(active) => updatePriceBook(selected, { workspaceId, active }).then(() => mutate())} /> : null}
    </DetailBlock>
  );
}

function PriceBookItems({ workspaceId, priceBookId, disabled, onToggleActive }: { workspaceId: string; priceBookId: string; disabled: boolean; onToggleActive: (active: boolean) => Promise<unknown> }) {
  const { data: items, mutate } = usePriceBookItems(workspaceId, priceBookId);
  const { data: products } = useProducts(workspaceId, { activeOnly: true });
  const { data: books } = usePriceBooks(workspaceId);
  const [productId, setProductId] = useState("");
  const [price, setPrice] = useState("");
  const [minimum, setMinimum] = useState("");
  const book = books?.find((item) => item.id === priceBookId);
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border/60 p-3">
      {book ? <label className="flex items-center gap-2 text-xs"><Switch checked={book.active} disabled={disabled} onCheckedChange={(active) => void onToggleActive(active)} />Tabela ativa</label> : null}
      {(items ?? []).map((item) => {
        const product = products?.find((candidate) => candidate.id === item.productId);
        return (
          <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{product?.name ?? item.productId}</span>
            <span className="flex items-center gap-2 tabular-nums text-muted-foreground">{formatCurrencyCents(item.listPriceCents)}{item.minimumPriceCents !== undefined ? ` · mín. ${formatCurrencyCents(item.minimumPriceCents)}` : ""}
              {!disabled ? <Button variant="ghost" size="icon" aria-label="Remover preço" onClick={() => deletePriceBookItem(priceBookId, item.id, workspaceId).then(() => mutate())}><Trash2 className="h-4 w-4" /></Button> : null}
            </span>
          </div>
        );
      })}
      {!disabled ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <SearchableCombo className="sm:col-span-2" items={(products ?? []).map((product) => ({ id: product.id, label: product.name }))} value={productId} onValueChange={setProductId} placeholder="Produto" searchPlaceholder="Buscar produto..." />
          <Input value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Preço nesta tabela" inputMode="decimal" />
          <div className="flex gap-2">
            <Input value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="Mínimo" inputMode="decimal" />
            <Button size="sm" disabled={!productId || !price.trim()} onClick={() => upsertPriceBookItem(priceBookId, { workspaceId, productId, listPriceCents: centsFromCurrencyInput(price), minimumPriceCents: minimum.trim() ? centsFromCurrencyInput(minimum) : undefined }).then(() => { setPrice(""); setMinimum(""); return mutate(); }).catch(toastError("Não foi possível salvar o preço"))}>Salvar</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { percentInputFromBp };
