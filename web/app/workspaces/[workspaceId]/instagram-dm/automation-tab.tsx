"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Spinner } from "@/components/Spinner";
import { createInstagramDmAutomationRule, deleteInstagramDmAutomationRule, updateInstagramDmAutomationRule } from "@/features/instagram-dm/api";
import { useInstagramDmAutomationRules } from "@/features/instagram-dm/hooks";
import type { InstagramDmAutomationMatchType, InstagramDmAutomationReplyMode, InstagramDmAutomationRule } from "@/features/instagram-dm/types";

const MATCH_TYPE_LABELS: Record<InstagramDmAutomationMatchType, string> = { contains: "contém", exact: "é exatamente", starts_with: "começa com" };

export function AutomationTab({ workspaceId, instagramBusinessAccountId }: { workspaceId: string; instagramBusinessAccountId: string }) {
  const { data, isLoading, error, mutate } = useInstagramDmAutomationRules(workspaceId, instagramBusinessAccountId);
  const rules = data?.rules ?? [];
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<InstagramDmAutomationRule | undefined>();
  const [deletingRule, setDeletingRule] = useState<InstagramDmAutomationRule | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();

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
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Regras avaliadas por prioridade — a primeira que casar com a mensagem recebida responde, nunca duas ao mesmo tempo.</p>
        <Button onClick={() => setNewRuleOpen(true)}>+ Nova regra</Button>
      </div>

      {feedback ? <Card className="mb-4 border-accent/30 bg-accent-soft/30 p-3"><p className="text-sm text-ink">{feedback}</p></Card> : null}

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-accent" /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : rules.length === 0 ? (
        <EmptyState title="Nenhuma regra de automação ainda" description="Crie uma regra pra responder automaticamente mensagens com uma palavra-chave específica." />
      ) : (
        <div className="grid gap-2">
          {rules.map((rule) => (
            <Card key={rule.id} className="p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink">{rule.name}</p>
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-muted">prioridade {rule.priority}</span>
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-muted">{rule.replyMode === "ai" ? "resposta por IA" : "resposta fixa"}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    Quando a mensagem {MATCH_TYPE_LABELS[rule.matchType]}: {rule.keywords.map((keyword) => `"${keyword}"`).join(", ")}
                  </p>
                  {rule.replyMode === "fixed" ? (
                    <p className="mt-1 text-xs text-ink">Resposta: {rule.replyText}</p>
                  ) : (
                    <p className="mt-1 text-xs text-ink">Instruções pra IA: {rule.aiInstructions || "—"}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => handleToggleEnabled(rule)}>{rule.enabled ? "Desativar" : "Ativar"}</Button>
                  <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setEditingRule(rule)}>Editar</Button>
                  <Button variant="danger" className="px-2.5 py-1.5 text-xs" onClick={() => setDeletingRule(rule)}>Excluir</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
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
            <select id="rule-match-type" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={matchType} onChange={(event) => setMatchType(event.target.value as InstagramDmAutomationMatchType)}>
              <option value="contains">Contém a palavra</option>
              <option value="exact">For exatamente igual</option>
              <option value="starts_with">Começar com</option>
            </select>
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
          <select id="rule-reply-mode" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink" value={replyMode} onChange={(event) => setReplyMode(event.target.value as InstagramDmAutomationReplyMode)}>
            <option value="fixed">Texto fixo</option>
            <option value="ai">Gerada por IA</option>
          </select>
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
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={submitting} onClick={handleSubmit}>{submitting ? "Salvando..." : existing ? "Salvar" : "Criar regra"}</Button>
        </div>
      </div>
    </Modal>
  );
}
