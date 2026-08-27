"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { ListCard } from "@/components/ListCard";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SortableHead } from "@/components/SortableHead";
import { Spinner } from "@/components/Spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useSortedRows } from "@/hooks/useSortedRows";
import { createInstagramDmAutomationRule, deleteInstagramDmAutomationRule, updateInstagramDmAutomationRule } from "@/features/instagram-dm/api";
import { useInstagramDmAutomationRules } from "@/features/instagram-dm/hooks";
import type { InstagramDmAutomationMatchType, InstagramDmAutomationReplyMode, InstagramDmAutomationRule } from "@/features/instagram-dm/types";

const MATCH_TYPE_LABELS: Record<InstagramDmAutomationMatchType, string> = { contains: "contém", exact: "é exatamente", starts_with: "começa com" };
type RuleSortKey = "name" | "priority" | "replyMode" | "enabled";

export function AutomationTab({ workspaceId, instagramBusinessAccountId }: { workspaceId: string; instagramBusinessAccountId: string }) {
  const { data, isLoading, error, mutate } = useInstagramDmAutomationRules(workspaceId, instagramBusinessAccountId);
  const rules = useMemo(() => data?.rules ?? [], [data]);
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<InstagramDmAutomationRule | undefined>();
  const [deletingRule, setDeletingRule] = useState<InstagramDmAutomationRule | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();

  const { sorted, sort, onSort } = useSortedRows<InstagramDmAutomationRule, RuleSortKey>(
    rules,
    {
      name: (rule) => rule.name.toLowerCase(),
      priority: (rule) => rule.priority,
      replyMode: (rule) => rule.replyMode,
      enabled: (rule) => (rule.enabled ? 1 : 0),
    },
    { key: "priority", dir: "asc" },
  );

  const { currentPage, totalPages, paginatedItems, setCurrentPage, resetPage, totalItems, pageSize, containerRef, availableHeight } = usePagination(sorted, { auto: true });
  useEffect(() => { resetPage(); }, [sort, resetPage]);

  async function handleToggleEnabled(rule: InstagramDmAutomationRule) {
    await updateInstagramDmAutomationRule(workspaceId, rule.id, { enabled: !rule.enabled });
    await mutate();
  }

  async function handleConfirmDelete() {
    if (!deletingRule) return;
    setDeleting(true);
    try {
      await deleteInstagramDmAutomationRule(workspaceId, deletingRule.id);
      await mutate();
      setFeedback("Regra excluída.");
      setDeletingRule(undefined);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Regras avaliadas por prioridade — a primeira que casar com a mensagem recebida responde, nunca duas ao mesmo tempo.</p>
        <Button onClick={() => setNewRuleOpen(true)}>+ Nova regra</Button>
      </div>

      {feedback ? <Card className="border-primary/30 bg-primary/5"><CardContent className="p-3"><p className="text-sm text-foreground">{feedback}</p></CardContent></Card> : null}

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : rules.length === 0 ? (
        <EmptyState title="Nenhuma regra de automação ainda" description="Crie uma regra pra responder automaticamente mensagens com uma palavra-chave específica." />
      ) : (
        <ListCard
          ref={containerRef}
          availableHeight={availableHeight}
          footer={<TablePagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setCurrentPage} />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead columnKey="name" sort={sort} onSort={onSort}>Regra</SortableHead>
                <TableHead>Palavras-chave</TableHead>
                <SortableHead columnKey="replyMode" sort={sort} onSort={onSort}>Resposta</SortableHead>
                <SortableHead columnKey="priority" sort={sort} onSort={onSort} align="right">Prioridade</SortableHead>
                <SortableHead columnKey="enabled" sort={sort} onSort={onSort}>Ativa</SortableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhuma regra nesta página.</TableCell>
                </TableRow>
              ) : (
                paginatedItems.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-foreground">{rule.name}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground" title={rule.keywords.join(", ")}>
                      {MATCH_TYPE_LABELS[rule.matchType]}: {rule.keywords.map((keyword) => `"${keyword}"`).join(", ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{rule.replyMode === "ai" ? "Gerada por IA" : "Texto fixo"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{rule.priority}</TableCell>
                    <TableCell>
                      <Switch checked={rule.enabled} onCheckedChange={() => handleToggleEnabled(rule)} aria-label={rule.enabled ? "Desativar regra" : "Ativar regra"} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditingRule(rule)}>Editar</Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeletingRule(rule)}>Excluir</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ListCard>
      )}

      {newRuleOpen ? (
        <AutomationRuleModal
          workspaceId={workspaceId}
          instagramBusinessAccountId={instagramBusinessAccountId}
          onClose={() => setNewRuleOpen(false)}
          onSaved={async () => {
            setNewRuleOpen(false);
            await mutate();
            setFeedback("Regra criada.");
          }}
        />
      ) : null}

      {editingRule ? (
        <AutomationRuleModal
          workspaceId={workspaceId}
          instagramBusinessAccountId={instagramBusinessAccountId}
          existing={editingRule}
          onClose={() => setEditingRule(undefined)}
          onSaved={async () => {
            setEditingRule(undefined);
            await mutate();
            setFeedback("Regra atualizada.");
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!deletingRule}
        title="Excluir regra de automação"
        description={deletingRule ? `A regra "${deletingRule.name}" para de responder mensagens imediatamente — essa ação não pode ser desfeita.` : ""}
        confirmLabel="Excluir"
        variant="danger"
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingRule(undefined)}
      />
    </div>
  );
}

function AutomationRuleModal({ workspaceId, instagramBusinessAccountId, existing, onClose, onSaved }: {
  workspaceId: string;
  instagramBusinessAccountId: string;
  existing?: InstagramDmAutomationRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [matchType, setMatchType] = useState<InstagramDmAutomationMatchType>(existing?.matchType ?? "contains");
  const [keywordsText, setKeywordsText] = useState(existing?.keywords.join("\n") ?? "");
  const [replyMode, setReplyMode] = useState<InstagramDmAutomationReplyMode>(existing?.replyMode ?? "fixed");
  const [replyText, setReplyText] = useState(existing?.replyText ?? "");
  const [aiInstructions, setAiInstructions] = useState(existing?.aiInstructions ?? "");
  const [priority, setPriority] = useState(String(existing?.priority ?? 0));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    const keywords = keywordsText.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!name.trim()) {
      setError("Dê um nome pra regra.");
      return;
    }
    if (keywords.length === 0) {
      setError("Informe pelo menos uma palavra-chave.");
      return;
    }
    if (replyMode === "fixed" && !replyText.trim()) {
      setError("Escreva o texto da resposta fixa.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const input = {
        instagramBusinessAccountId,
        name: name.trim(),
        matchType,
        keywords,
        replyMode,
        replyText: replyMode === "fixed" ? replyText.trim() : undefined,
        aiInstructions: replyMode === "ai" ? aiInstructions.trim() || undefined : undefined,
        priority: Number(priority) || 0,
      };
      if (existing) {
        await updateInstagramDmAutomationRule(workspaceId, existing.id, input);
      } else {
        await createInstagramDmAutomationRule(workspaceId, input);
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a regra.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={existing ? `Editar "${existing.name}"` : "Nova regra de automação"} onClose={onClose} maxWidthClass="sm:max-w-lg">
      <div className="grid gap-4">
        <div>
          <Label htmlFor="rule-name">Nome</Label>
          <Input id="rule-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Perguntas sobre preço" autoFocus />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="rule-match-type">Quando a mensagem</Label>
            <Select value={matchType} onValueChange={(value) => setMatchType(value as InstagramDmAutomationMatchType)}>
              <SelectTrigger id="rule-match-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">Contém a palavra</SelectItem>
                <SelectItem value="exact">For exatamente igual</SelectItem>
                <SelectItem value="starts_with">Começar com</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="rule-priority">Prioridade (menor = avaliada primeiro)</Label>
            <Input id="rule-priority" type="number" value={priority} onChange={(event) => setPriority(event.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="rule-keywords">Palavras-chave (uma por linha)</Label>
          <Textarea id="rule-keywords" rows={3} value={keywordsText} onChange={(event) => setKeywordsText(event.target.value)} placeholder={"preço\nvalor\nquanto custa"} />
        </div>
        <div>
          <Label htmlFor="rule-reply-mode">Tipo de resposta</Label>
          <Select value={replyMode} onValueChange={(value) => setReplyMode(value as InstagramDmAutomationReplyMode)}>
            <SelectTrigger id="rule-reply-mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Texto fixo</SelectItem>
              <SelectItem value="ai">Gerada por IA</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {replyMode === "fixed" ? (
          <div>
            <Label htmlFor="rule-reply-text">Texto da resposta</Label>
            <Textarea id="rule-reply-text" rows={3} value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Ex.: Nossos preços começam em R$ 99. Confira o catálogo no link da bio!" />
          </div>
        ) : (
          <div>
            <Label htmlFor="rule-ai-instructions">Instruções pra IA (opcional)</Label>
            <Textarea id="rule-ai-instructions" rows={3} value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} placeholder="Ex.: Responda em tom informal, mencione que o catálogo está no link da bio." />
          </div>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={submitting} onClick={handleSubmit}>{submitting ? "Salvando..." : existing ? "Salvar" : "Criar regra"}</Button>
        </div>
      </div>
    </Modal>
  );
}
