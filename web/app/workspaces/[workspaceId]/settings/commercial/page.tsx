"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Card, CardBody } from "@/components/Card";
import { DetailBlock } from "@/components/DetailModal";
import { Input, Label, MoneyInput, Textarea } from "@/components/Field";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { FunnelStagesBlock } from "@/components/sales/FunnelStagesBlock";
import { ErrorState } from "@/components/ErrorState";
import { Spinner } from "@/components/Spinner";
import { useTeams } from "@/features/identity/hooks";
import { TeamPicker, teamLabel } from "@/components/TeamPicker";
import { UserPicker, userLabel } from "@/components/UserPicker";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  useCommercialSettings,
  useCompetitors,
  useCustomFields,
  usePolicies,
  usePriceBookItems,
  usePriceBooks,
  useReasons,
} from "@/features/sales/hooks";
import {
  bpFromPercentInput,
  formatBp,
  percentInputFromBp,
} from "@/features/sales/presentation";
import type {
  CloseReasonKind,
  CommercialPolicy,
  CustomFieldType,
} from "@/features/sales/types";
import { formatCurrencyCents } from "@/lib/format";

const toastError = (title: string) => (cause: unknown) =>
  toast.error(title, {
    description:
      cause instanceof Error
        ? cause.message.replace(/^[A-Z_]+:\s*/, "")
        : undefined,
  });

/** Configuração comercial do Vorix Conversas — tudo o que é regra da empresa (nunca hardcoded). */
export default function CommercialSettingsPage() {
  const workspace = useCurrentWorkspace();
  const {
    data: settings,
    error,
    isLoading,
    mutate,
  } = useCommercialSettings(workspace.id);
  const isManager = settings?.visibility.isManager ?? false;

  return (
    <SettingsShell
      active="commercial"
      title="Regras comerciais"
      description="Escolha como sua equipe pode vender. Abra um assunto de cada vez para ajustar."
    >
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading || !settings ? (
        <div
          role="status"
          className="flex items-center justify-center gap-3 py-14"
        >
          <Spinner />
          Carregando configurações…
        </div>
      ) : (
        <div className="space-y-4 [&_input]:min-h-11 [&_button]:min-h-11 [&_textarea]:text-base">
          <div className="rounded-xl border border-border bg-muted/30 p-5">
            <h2 className="text-lg font-semibold">Configure no seu ritmo</h2>
            <p className="mt-2 text-base text-muted-foreground">
              Comece pelos acessos e pelos limites de desconto. As outras opções
              podem ser ajustadas quando precisar.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Cada seção explica para que serve. Você não precisa preencher tudo
              para começar a vender.
            </p>
          </div>
          {!isManager ? (
            <p
              role="status"
              className="rounded-lg border border-border p-4 text-sm"
            >
              Você pode consultar as regras. Somente quem administra a conta
              pode alterá-las.
            </p>
          ) : null}
          <SettingsTopic
            title="1. Quem pode ver e fazer o quê"
            description="Escolha o que os vendedores podem consultar e como finalizar uma venda."
            initialOpen
          >
            <GeneralBlock
              workspaceId={workspace.id}
              settings={settings}
              disabled={!isManager}
              onSaved={() => mutate()}
            />
          </SettingsTopic>
          <SettingsTopic
            title="2. Descontos e aprovação"
            description="Defina até onde a equipe pode negociar sem pedir autorização."
          >
            <PoliciesBlock workspaceId={workspace.id} disabled={!isManager} />
          </SettingsTopic>
          <SettingsTopic
            title="3. Mensagens das propostas"
            description="Prepare o texto de envio e de lembrete para usar no WhatsApp."
          >
            <TemplatesBlock
              workspaceId={workspace.id}
              settings={settings}
              disabled={!isManager}
              onSaved={() => mutate()}
            />
          </SettingsTopic>
          <SettingsTopic
            title="4. Motivos de venda e concorrentes"
            description="Organize os motivos de ganho, perda e recusa para entender seus resultados."
          >
            <ReasonsBlock workspaceId={workspace.id} disabled={!isManager} />
          </SettingsTopic>
          <SettingsTopic
            title="5. Etapas da venda"
            description="Organize o caminho da oportunidade, do primeiro contato ao fechamento."
          >
            <FunnelStagesBlock
              workspaceId={workspace.id}
              disabled={!isManager}
            />
          </SettingsTopic>
          <SettingsTopic
            title="Opções adicionais (opcionais)"
            description="Campos extras e preços diferentes para grupos de clientes. Use apenas se precisar."
          >
            <div className="space-y-8">
              <CustomFieldsBlock
                workspaceId={workspace.id}
                disabled={!isManager}
              />
              <PriceBooksBlock
                workspaceId={workspace.id}
                disabled={!isManager}
              />
            </div>
          </SettingsTopic>
        </div>
      )}
    </SettingsShell>
  );
}

function SettingsTopic({
  title,
  description,
  initialOpen,
  children,
}: {
  title: string;
  description: string;
  initialOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      name="commercial-topics"
      open={initialOpen}
      className="group rounded-xl border border-border bg-card"
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-base font-semibold text-foreground">
            {title}
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
            {description}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-border p-5">{children}</div>
    </details>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div>
        <label
          htmlFor={id}
          className="cursor-pointer text-base font-medium text-foreground"
        >
          {label}
        </label>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <p className="mt-1 text-sm font-medium">{checked ? "Sim" : "Não"}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function GeneralBlock({
  workspaceId,
  settings,
  disabled,
  onSaved,
}: {
  workspaceId: string;
  settings: NonNullable<ReturnType<typeof useCommercialSettings>["data"]>;
  disabled: boolean;
  onSaved: () => void;
}) {
  const values = () => ({
    sellersCanViewCost: settings.sellersCanViewCost,
    sellersCanViewMargin: settings.sellersCanViewMargin,
    proposalAcceptAutoWin: settings.proposalAcceptAutoWin,
    rankingEnabled: settings.rankingEnabled,
    dealVisibility: settings.dealVisibility,
  });
  const [draft, setDraft] = useState(values);
  const [months, setMonths] = useState(
    settings.defaultContractMonths
      ? String(settings.defaultContractMonths)
      : "",
  );
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    setDraft(values());
    setMonths(
      settings.defaultContractMonths
        ? String(settings.defaultContractMonths)
        : "",
    );
  }, [settings]);
  const changed =
    JSON.stringify(draft) !== JSON.stringify(values()) ||
    months !==
      (settings.defaultContractMonths
        ? String(settings.defaultContractMonths)
        : "");
  async function save() {
    if (months && (Number(months) < 1 || Number(months) > 600)) {
      setError("Informe uma duração entre 1 e 600 meses, ou deixe em branco.");
      return;
    }
    setBusy(true);
    setSaved(false);
    setError(undefined);
    try {
      await updateCommercialSettings({
        workspaceId,
        ...draft,
        defaultContractMonths: months ? Number(months) : null,
      });
      onSaved();
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace(/^[A-Z_]+:\s*/, "")
          : "Não foi possível salvar. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Escolha Sim ou Não. Suas alterações só entram em vigor ao clicar em
        “Salvar acessos e fechamento”.
      </p>
      <div className="divide-y divide-border/60">
        <ToggleRow
          label="Vendedores podem ver o custo dos produtos?"
          description="Custo é quanto a empresa paga. Quem administra a conta sempre pode consultar esse valor."
          checked={draft.sellersCanViewCost}
          disabled={disabled || busy}
          onChange={(value) => {
            setDraft({ ...draft, sellersCanViewCost: value });
            setSaved(false);
          }}
        />
        <ToggleRow
          label="Vendedores podem ver lucro e margem?"
          description="Lucro é o que sobra da venda após o custo. Margem é essa sobra em porcentagem."
          checked={draft.sellersCanViewMargin}
          disabled={disabled || busy}
          onChange={(value) => {
            setDraft({ ...draft, sellersCanViewMargin: value });
            setSaved(false);
          }}
        />
        <ToggleRow
          label="Finalizar a venda quando o cliente aceitar a proposta?"
          description="Se escolher Não, a equipe recebe o aceite e finaliza a venda manualmente. É a opção recomendada para começar."
          checked={draft.proposalAcceptAutoWin}
          disabled={disabled || busy}
          onChange={(value) => {
            setDraft({ ...draft, proposalAcceptAutoWin: value });
            setSaved(false);
          }}
        />
        <ToggleRow
          label="Mostrar a classificação dos vendedores?"
          description="Exibe os resultados da equipe ordenados pelo desempenho de cada vendedor."
          checked={draft.rankingEnabled}
          disabled={disabled || busy}
          onChange={(value) => {
            setDraft({ ...draft, rankingEnabled: value });
            setSaved(false);
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="deal-visibility">
          Quais oportunidades cada vendedor pode ver?
        </Label>
        <Select
          value={draft.dealVisibility}
          disabled={disabled || busy}
          onValueChange={(value) => {
            setDraft({
              ...draft,
              dealVisibility: value as typeof draft.dealVisibility,
            });
            setSaved(false);
          }}
        >
          <SelectTrigger id="deal-visibility" className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              Todas as oportunidades da empresa
            </SelectItem>
            <SelectItem value="team">As suas e as da sua equipe</SelectItem>
            <SelectItem value="own">Somente as suas oportunidades</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <details className="rounded-lg border border-border p-4">
        <summary className="min-h-11 cursor-pointer text-base font-medium">
          Duração padrão de contratos (opcional)
        </summary>
        <div className="space-y-2 pt-3">
          <Label htmlFor="default-contract">
            Quantos meses costuma durar um contrato?
          </Label>
          <Input
            id="default-contract"
            value={months}
            disabled={disabled || busy}
            placeholder="Ex.: 12"
            onChange={(event) => {
              setMonths(event.target.value.replace(/\D/g, ""));
              setSaved(false);
            }}
            inputMode="numeric"
          />
          <p className="text-sm text-muted-foreground">
            Usado para calcular o valor total de contratos recorrentes. Se não
            souber, pode deixar em branco; o cálculo usa 12 meses quando não
            houver uma duração informada.
          </p>
        </div>
      </details>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-foreground">
          Alterações salvas com sucesso.
        </p>
      ) : null}
      {!disabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            loading={busy}
            disabled={busy || !changed}
            onClick={() => void save()}
          >
            Salvar acessos e fechamento
          </Button>
          <span className="text-sm text-muted-foreground">
            {changed
              ? "Você tem alterações para salvar."
              : "Nenhuma alteração pendente."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function PoliciesBlock({
  workspaceId,
  disabled,
}: {
  workspaceId: string;
  disabled: boolean;
}) {
  const { data: policies, error, isLoading, mutate } = usePolicies(workspaceId);
  const { data: memberData } = useInboxMembers(workspaceId);
  const { data: teams } = useTeams(workspaceId);
  const [scopeType, setScopeType] =
    useState<CommercialPolicy["scopeType"]>("workspace");
  const [scopeId, setScopeId] = useState("");
  const [minMargin, setMinMargin] = useState(""),
    [maxDiscount, setMaxDiscount] = useState("");
  const [allowBelow, setAllowBelow] = useState(false),
    [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<CommercialPolicy>();
  const [formError, setFormError] = useState<string>(),
    [saved, setSaved] = useState(false);
  const scopeLabel = (
    policy: Pick<CommercialPolicy, "scopeType" | "scopeId">,
  ) =>
    policy.scopeType === "workspace"
      ? "Toda a empresa"
      : policy.scopeType === "role"
        ? ((
            {
              owner: "Donos da conta",
              admin: "Gestores",
              editor: "Vendedores",
              viewer: "Usuários de consulta",
            } as Record<string, string>
          )[policy.scopeId ?? ""] ?? "Tipo de usuário")
        : policy.scopeType === "user"
          ? userLabel(policy.scopeId, memberData?.members)
          : teamLabel(policy.scopeId, teams);
  const margin = bpFromPercentInput(minMargin),
    discount = bpFromPercentInput(maxDiscount);
  const existing = policies?.find(
    (policy) =>
      policy.scopeType === scopeType && (policy.scopeId ?? "") === scopeId,
  );
  useEffect(() => {
    const current = policies?.find(
      (policy) =>
        policy.scopeType === scopeType && (policy.scopeId ?? "") === scopeId,
    );
    setMinMargin(percentInputFromBp(current?.minMarginBp));
    setMaxDiscount(percentInputFromBp(current?.maxDiscountBp));
    setAllowBelow(current?.allowBelowMinimum ?? false);
  }, [policies, scopeType, scopeId]);
  async function save() {
    if (
      minMargin.trim() &&
      (margin === undefined || margin < -100000 || margin > 10000)
    ) {
      setFormError(
        "Informe uma margem válida, até 100%, ou deixe o campo em branco.",
      );
      return;
    }
    if (
      maxDiscount.trim() &&
      (discount === undefined || discount < 0 || discount > 10000)
    ) {
      setFormError("O desconto deve ser um número de 0 a 100.");
      return;
    }
    if (scopeType !== "workspace" && !scopeId) {
      setFormError(
        "Escolha a pessoa, equipe ou tipo de usuário para esta regra.",
      );
      return;
    }
    setBusy(true);
    setFormError(undefined);
    setSaved(false);
    try {
      await upsertPolicy({
        workspaceId,
        scopeType,
        scopeId: scopeType === "workspace" ? undefined : scopeId,
        minMarginBp: margin ?? null,
        maxDiscountBp: discount ?? null,
        allowBelowMinimum: allowBelow,
      });
      await mutate();
      setSaved(true);
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message.replace(/^[A-Z_]+:\s*/, "")
          : "Não foi possível salvar. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <p className="text-base text-muted-foreground">
        Comece por uma regra para toda a empresa. Se a equipe ultrapassar um
        limite, um gestor precisará aprovar antes de enviar a proposta.
      </p>
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          {!policies?.length ? (
            <p className="rounded-lg bg-muted/40 p-4 text-sm">
              Ainda não há limites personalizados. Por enquanto, negociar abaixo
              do preço mínimo do produto exige aprovação.
            </p>
          ) : (
            policies.map((policy) => (
              <div
                key={policy.id}
                className="rounded-lg border border-border p-4"
              >
                <h3 className="font-semibold">{scopeLabel(policy)}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Desconto sem aprovação:{" "}
                  {policy.maxDiscountBp === undefined
                    ? "sem limite de desconto definido"
                    : "até " + formatBp(policy.maxDiscountBp)}
                  .
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Margem mínima:{" "}
                  {policy.minMarginBp === undefined
                    ? "não definida"
                    : formatBp(policy.minMarginBp)}
                  .{" "}
                  {policy.allowBelowMinimum
                    ? "Permite negociar abaixo do preço mínimo."
                    : "Abaixo do preço mínimo, precisa de aprovação."}
                </p>
                {!disabled ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setScopeType(policy.scopeType);
                        setScopeId(policy.scopeId ?? "");
                        setMinMargin(percentInputFromBp(policy.minMarginBp));
                        setMaxDiscount(
                          percentInputFromBp(policy.maxDiscountBp),
                        );
                        setAllowBelow(policy.allowBelowMinimum);
                        setSaved(false);
                      }}
                    >
                      Ajustar esta regra
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setRemoving(policy)}
                    >
                      Remover
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
      {!disabled && !error ? (
        <div className="space-y-5 rounded-xl bg-muted/30 p-5">
          <h3 className="text-lg font-semibold">
            {existing
              ? "Ajustar limite existente"
              : "Definir um limite de negociação"}
          </h3>
          <div className="space-y-2">
            <Label htmlFor="policy-scope">1. Para quem vale esta regra?</Label>
            <Select
              value={scopeType}
              onValueChange={(value) => {
                setScopeType(value as CommercialPolicy["scopeType"]);
                setScopeId(value === "role" ? "editor" : "");
                setMinMargin("");
                setMaxDiscount("");
                setAllowBelow(false);
                setSaved(false);
              }}
            >
              <SelectTrigger id="policy-scope" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">
                  Toda a empresa (comece por aqui)
                </SelectItem>
                <SelectItem value="user">Uma pessoa específica</SelectItem>
                <SelectItem value="team">Uma equipe</SelectItem>
                <SelectItem value="role">Um tipo de usuário</SelectItem>
              </SelectContent>
            </Select>
            {scopeType === "user" ? (
              <UserPicker
                workspaceId={workspaceId}
                value={scopeId}
                onValueChange={setScopeId}
              />
            ) : scopeType === "team" ? (
              <TeamPicker
                workspaceId={workspaceId}
                value={scopeId}
                onValueChange={setScopeId}
              />
            ) : scopeType === "role" ? (
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger aria-label="Tipo de usuário">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Vendedores</SelectItem>
                  <SelectItem value="admin">Gestores</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pol-discount">
              2. Quanto desconto pode dar sem pedir aprovação?
            </Label>
            <Input
              id="pol-discount"
              value={maxDiscount}
              onChange={(event) => {
                setMaxDiscount(event.target.value);
                setSaved(false);
              }}
              placeholder="Ex.: 10"
              inputMode="decimal"
            />
            <p className="text-sm text-muted-foreground">
              Digite a porcentagem. Exemplo: 10 significa até 10% de desconto.
              Em uma venda de R$ 100, são R$ 10 de desconto. Em branco, não há
              limite de desconto nesta regra.
            </p>
          </div>
          <details className="rounded-lg border border-border p-4">
            <summary className="min-h-11 cursor-pointer text-base font-medium">
              Também quero proteger o lucro e o preço mínimo
            </summary>
            <div className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label htmlFor="pol-margin">Margem mínima de lucro (%)</Label>
                <Input
                  id="pol-margin"
                  value={minMargin}
                  onChange={(event) => {
                    setMinMargin(event.target.value);
                    setSaved(false);
                  }}
                  placeholder="Ex.: 30"
                  inputMode="decimal"
                />
                <p className="text-sm text-muted-foreground">
                  Exemplo: vender por R$ 100 algo que custa R$ 70 deixa R$ 30,
                  uma margem de 30%. Em branco, não há margem mínima nesta
                  regra.
                </p>
              </div>
              <ToggleRow
                label="Pode negociar abaixo do preço mínimo do produto?"
                description="Escolha Não para exigir aprovação quando o vendedor baixar além do mínimo. Mesmo com Sim, os outros limites continuam valendo."
                checked={allowBelow}
                disabled={busy}
                onChange={(value) => {
                  setAllowBelow(value);
                  setSaved(false);
                }}
              />
            </div>
          </details>
          <div className="rounded-lg border border-border p-4">
            <h4 className="font-semibold">Resumo da regra</h4>
            <p className="mt-2 text-sm">
              Vale para: {scopeLabel({ scopeType, scopeId })}.
            </p>
            <p className="mt-1 text-sm">
              {discount === undefined
                ? "Sem limite de desconto definido."
                : "Descontos acima de " +
                  formatBp(discount) +
                  " precisarão de aprovação."}
            </p>
            <p className="mt-1 text-sm">
              {margin === undefined
                ? "Sem margem mínima definida."
                : "Margens abaixo de " +
                  formatBp(margin) +
                  " precisarão de aprovação."}
            </p>
            {existing ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Ao salvar, você substitui os limites atuais deste grupo. Use
                “Ajustar regra” acima para carregar os valores atuais.
              </p>
            ) : null}
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm">
              Regra salva com sucesso.
            </p>
          ) : null}
          <Button
            loading={busy}
            disabled={busy || (scopeType !== "workspace" && !scopeId)}
            onClick={() => void save()}
          >
            {existing
              ? "Salvar alterações da regra"
              : "Salvar regra de desconto"}
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Se houver várias regras, vale primeiro a da pessoa, depois a da equipe,
        depois a do tipo de usuário e, por último, a da empresa.
      </p>
      <ConfirmDialog
        open={!!removing}
        title="Remover regra de desconto?"
        description={
          removing
            ? "A regra de " +
              scopeLabel(removing) +
              " deixará de valer. Passará a valer a regra mais geral disponível."
            : ""
        }
        confirmLabel="Remover regra"
        variant="danger"
        onCancel={() => setRemoving(undefined)}
        onConfirm={async () => {
          try {
            await deletePolicy(removing!.id, workspaceId);
            await mutate();
            setRemoving(undefined);
          } catch (cause) {
            toastError("Não foi possível remover")(cause);
          }
        }}
      />
    </div>
  );
}

function TemplatesBlock({
  workspaceId,
  settings,
  disabled,
  onSaved,
}: {
  workspaceId: string;
  settings: NonNullable<ReturnType<typeof useCommercialSettings>["data"]>;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [send, setSend] = useState(settings.proposalWhatsappTemplate ?? "");
  const [reminder, setReminder] = useState(
    settings.proposalReminderTemplate ?? "",
  );
  useEffect(() => {
    setSend(settings.proposalWhatsappTemplate ?? "");
    setReminder(settings.proposalReminderTemplate ?? "");
  }, [settings.proposalWhatsappTemplate, settings.proposalReminderTemplate]);
  return (
    <DetailBlock label="Mensagens da proposta no WhatsApp">
      <p className="mb-2 text-xs text-muted-foreground">
        As palavras entre chaves são preenchidas pelo sistema: {"{{nome}}"} vira
        o nome do cliente e {"{{valor}}"} vira o valor da proposta. Mantenha{" "}
        {"{{proposal_link}}"} no texto de envio para incluir o link. Se deixar
        em branco, será usada a mensagem padrão.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="tpl-send">Envio da proposta</Label>
          <Textarea
            id="tpl-send"
            rows={6}
            value={send}
            disabled={disabled}
            onChange={(event) => setSend(event.target.value)}
            placeholder={
              "Olá, {{nome}}!\n\nSua proposta comercial está disponível.\nValor: {{valor}}\nValidade: {{validade}}\n\n{{proposal_link}}"
            }
          />
        </div>
        <div>
          <Label htmlFor="tpl-remind">Lembrete</Label>
          <Textarea
            id="tpl-remind"
            rows={6}
            value={reminder}
            disabled={disabled}
            onChange={(event) => setReminder(event.target.value)}
            placeholder={
              "Olá, {{nome}}! Passando para lembrar da proposta ({{valor}}).\n\n{{proposal_link}}"
            }
          />
        </div>
      </div>
      {!disabled ? (
        <Button
          size="sm"
          className="mt-2"
          onClick={() =>
            updateCommercialSettings({
              workspaceId,
              proposalWhatsappTemplate: send.trim() || null,
              proposalReminderTemplate: reminder.trim() || null,
            })
              .then(() => {
                onSaved();
                toast.success("Mensagens salvas.");
              })
              .catch(toastError("Não foi possível salvar"))
          }
        >
          Salvar mensagens
        </Button>
      ) : null}
    </DetailBlock>
  );
}

const REASON_KIND_LABEL: Record<CloseReasonKind, string> = {
  lost: "Motivos de perda",
  won: "Motivos de ganho",
  proposal_decline: "Motivos de recusa da proposta (cliente)",
};

function ReasonsBlock({
  workspaceId,
  disabled,
}: {
  workspaceId: string;
  disabled: boolean;
}) {
  const { data: reasons, mutate } = useReasons(workspaceId, undefined, true);
  const { data: competitors, mutate: mutateCompetitors } = useCompetitors(
    workspaceId,
    true,
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [competitor, setCompetitor] = useState("");
  return (
    <DetailBlock label="Motivos e concorrentes">
      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(REASON_KIND_LABEL) as CloseReasonKind[]).map((kind) => (
          <div key={kind}>
            <p className="mb-1.5 text-sm font-medium">
              {REASON_KIND_LABEL[kind]}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(reasons ?? [])
                .filter((reason) => reason.kind === kind)
                .map((reason) => (
                  <button
                    key={reason.id}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      updateReason(reason.id, {
                        workspaceId,
                        active: !reason.active,
                      })
                        .then(() => mutate())
                        .catch(toastError("Não foi possível alterar"))
                    }
                    className={
                      reason.active
                        ? "rounded-full border border-border px-2.5 py-1 text-xs"
                        : "rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground line-through"
                    }
                    title={
                      reason.active
                        ? "Clique para desativar"
                        : "Clique para reativar"
                    }
                  >
                    {reason.label}
                  </button>
                ))}
            </div>
            {!disabled ? (
              <div className="mt-2 flex gap-2">
                <Input
                  value={drafts[kind] ?? ""}
                  onChange={(event) =>
                    setDrafts({ ...drafts, [kind]: event.target.value })
                  }
                  placeholder="Novo motivo"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!drafts[kind]?.trim()}
                  onClick={() =>
                    createReason({
                      workspaceId,
                      kind,
                      label: drafts[kind].trim(),
                    })
                      .then(() => {
                        setDrafts({ ...drafts, [kind]: "" });
                        return mutate();
                      })
                      .catch(toastError("Não foi possível criar"))
                  }
                >
                  Adicionar
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        <div>
          <p className="mb-1.5 text-sm font-medium">Concorrentes</p>
          <div className="flex flex-wrap gap-1.5">
            {(competitors ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() =>
                  updateCompetitor(item.id, {
                    workspaceId,
                    active: !item.active,
                  })
                    .then(() => mutateCompetitors())
                    .catch(toastError("Não foi possível alterar"))
                }
                className={
                  item.active
                    ? "rounded-full border border-border px-2.5 py-1 text-xs"
                    : "rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground line-through"
                }
              >
                {item.name}
              </button>
            ))}
            {(competitors ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">
                Nenhum — também são criados ao marcar uma perda.
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={competitor}
              onChange={(event) => setCompetitor(event.target.value)}
              placeholder="Nome do concorrente"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={!competitor.trim()}
              onClick={() =>
                createCompetitor({ workspaceId, name: competitor.trim() })
                  .then(() => {
                    setCompetitor("");
                    return mutateCompetitors();
                  })
                  .catch(toastError("Não foi possível criar"))
              }
            >
              Adicionar
            </Button>
          </div>
        </div>
      </div>
    </DetailBlock>
  );
}

const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "Texto",
  number: "Número",
  currency: "Moeda",
  date: "Data",
  select: "Seleção",
  multi_select: "Múltipla seleção",
  boolean: "Sim/Não",
};

function CustomFieldsBlock({
  workspaceId,
  disabled,
}: {
  workspaceId: string;
  disabled: boolean;
}) {
  const { data: fields, mutate } = useCustomFields(workspaceId, true);
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const key = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 40);
  return (
    <DetailBlock label="Campos personalizados da oportunidade">
      <p className="mb-2 text-xs text-muted-foreground">
        Use em etapas do funil como campos obrigatórios (ex.: decisor,
        orçamento) — configure em Oportunidades › etapas.
      </p>
      <div className="mb-3 space-y-1.5">
        {(fields ?? []).map((field) => (
          <div
            key={field.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
          >
            <span>
              {field.label}{" "}
              <span className="text-xs text-muted-foreground">
                · {FIELD_TYPE_LABEL[field.fieldType]} · custom:{field.key}
              </span>
            </span>
            {!disabled ? (
              <Switch
                checked={field.active}
                onCheckedChange={(active) =>
                  updateCustomField(field.id, { workspaceId, active })
                    .then(() => mutate())
                    .catch(toastError("Não foi possível alterar"))
                }
              />
            ) : null}
          </div>
        ))}
      </div>
      {!disabled ? (
        <div className="grid gap-2 rounded-xl bg-muted/40 p-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="cf-label">Nome do campo</Label>
            <Input
              id="cf-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Ex.: Orçamento aprovado"
            />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select
              value={fieldType}
              onValueChange={(value) => setFieldType(value as CustomFieldType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FIELD_TYPE_LABEL) as CustomFieldType[]).map(
                  (type) => (
                    <SelectItem key={type} value={type}>
                      {FIELD_TYPE_LABEL[type]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              className="w-full"
              disabled={
                !key ||
                ((fieldType === "select" || fieldType === "multi_select") &&
                  !options.trim())
              }
              onClick={() =>
                createCustomField({
                  workspaceId,
                  key,
                  label: label.trim(),
                  fieldType,
                  options: options
                    .split(",")
                    .map((option) => option.trim())
                    .filter(Boolean),
                })
                  .then(() => {
                    setLabel("");
                    setOptions("");
                    return mutate();
                  })
                  .catch(toastError("Não foi possível criar o campo"))
              }
            >
              Criar campo
            </Button>
          </div>
          {fieldType === "select" || fieldType === "multi_select" ? (
            <div className="sm:col-span-4">
              <Label htmlFor="cf-options">Opções (separadas por vírgula)</Label>
              <Input
                id="cf-options"
                value={options}
                onChange={(event) => setOptions(event.target.value)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </DetailBlock>
  );
}

function PriceBooksBlock({
  workspaceId,
  disabled,
}: {
  workspaceId: string;
  disabled: boolean;
}) {
  const { data: books, mutate } = usePriceBooks(workspaceId);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>();
  return (
    <DetailBlock label="Preços diferentes por grupo de clientes">
      <p className="mb-2 text-xs text-muted-foreground">
        Ex.: parceiros, enterprise, região Sul. Sem tabela, vale o preço de
        tabela do produto.
      </p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {(books ?? []).map((book) => (
          <button
            key={book.id}
            type="button"
            onClick={() =>
              setSelected(selected === book.id ? undefined : book.id)
            }
            className={
              selected === book.id
                ? "rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs"
                : "rounded-full border border-border px-3 py-1 text-xs"
            }
          >
            {book.name}
            {book.active ? "" : " (inativa)"}
          </button>
        ))}
      </div>
      {!disabled ? (
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nova tabela"
            className="max-w-xs"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!name.trim()}
            onClick={() =>
              createPriceBook({ workspaceId, name: name.trim() })
                .then(() => {
                  setName("");
                  return mutate();
                })
                .catch(toastError("Não foi possível criar"))
            }
          >
            Criar tabela
          </Button>
        </div>
      ) : null}
      {selected ? (
        <PriceBookItems
          workspaceId={workspaceId}
          priceBookId={selected}
          disabled={disabled}
          onToggleActive={(active) =>
            updatePriceBook(selected, { workspaceId, active }).then(() =>
              mutate(),
            )
          }
        />
      ) : null}
    </DetailBlock>
  );
}

function PriceBookItems({
  workspaceId,
  priceBookId,
  disabled,
  onToggleActive,
}: {
  workspaceId: string;
  priceBookId: string;
  disabled: boolean;
  onToggleActive: (active: boolean) => Promise<unknown>;
}) {
  const { data: items, mutate } = usePriceBookItems(workspaceId, priceBookId);
  const { data: products } = useProducts(workspaceId, { activeOnly: true });
  const { data: books } = usePriceBooks(workspaceId);
  const [productId, setProductId] = useState("");
  const [price, setPrice] = useState("");
  const [minimum, setMinimum] = useState("");
  const book = books?.find((item) => item.id === priceBookId);
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border/60 p-3">
      {book ? (
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={book.active}
            disabled={disabled}
            onCheckedChange={(active) => void onToggleActive(active)}
          />
          Tabela ativa
        </label>
      ) : null}
      {(items ?? []).map((item) => {
        const product = products?.find(
          (candidate) => candidate.id === item.productId,
        );
        return (
          <div
            key={item.id}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span>{product?.name ?? item.productId}</span>
            <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
              {formatCurrencyCents(item.listPriceCents)}
              {item.minimumPriceCents !== undefined
                ? ` · mín. ${formatCurrencyCents(item.minimumPriceCents)}`
                : ""}
              {!disabled ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remover preço"
                  onClick={() =>
                    deletePriceBookItem(priceBookId, item.id, workspaceId).then(
                      () => mutate(),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </span>
          </div>
        );
      })}
      {!disabled ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <SearchableCombo
            className="sm:col-span-2"
            items={(products ?? []).map((product) => ({
              id: product.id,
              label: product.name,
            }))}
            value={productId}
            onValueChange={setProductId}
            placeholder="Produto"
            searchPlaceholder="Buscar produto..."
          />
          <MoneyInput
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="Preço nesta tabela"
            aria-label="Preço nesta tabela"
          />
          <div className="flex gap-2">
            <MoneyInput
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
              placeholder="Mínimo"
              aria-label="Preço mínimo nesta tabela"
            />
            <Button
              size="sm"
              disabled={!productId || !price.trim()}
              onClick={() =>
                upsertPriceBookItem(priceBookId, {
                  workspaceId,
                  productId,
                  listPriceCents: centsFromCurrencyInput(price),
                  minimumPriceCents: minimum.trim()
                    ? centsFromCurrencyInput(minimum)
                    : undefined,
                })
                  .then(() => {
                    setPrice("");
                    setMinimum("");
                    return mutate();
                  })
                  .catch(toastError("Não foi possível salvar o preço"))
              }
            >
              Salvar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { percentInputFromBp };
