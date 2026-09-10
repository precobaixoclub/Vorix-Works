"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, Select, SelectItem, Textarea } from "@/components/Field";
import { Logo } from "@/components/Logo";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { apiClient } from "@/lib/api-client";
import { updateWorkspace } from "@/features/workspace/api";
import type { TenantRole } from "@/features/identity/types";
import { getInboxConnectionQrCode } from "@/features/inbox/api";
import { useInboxConnections } from "@/features/inbox/hooks";
import {
  advanceOnboardingStep,
  completeOnboarding,
  connectChannelDuringOnboarding,
  inviteTeamMemberDuringOnboarding,
  saveOnboardingCompanyStep,
  startOnboarding,
} from "@/features/onboarding/api";
import { useOnboarding } from "@/features/onboarding/hooks";
import { ONBOARDING_GOALS, ONBOARDING_STEPS, type OnboardingGoal, type OnboardingStep } from "@/features/onboarding/types";

/**
 * Onboarding guiado (`/workspaces/:workspaceId/onboarding`) — um wizard por etapas, uma ação
 * principal por tela (seção 2 do pedido). O `[workspaceId]/layout.tsx` esconde a sidebar/topbar
 * completa nesta rota (seção 21) — aqui só existe o cabeçalho "Passo X de Y" + "Salvar e sair".
 *
 * Nunca é um gate bloqueante: se o usuário sair no meio, o progresso já está salvo no backend
 * (cada ação real grava na hora) — reabrir esta rota depois retoma exatamente de onde parou
 * (`currentStep` persistido), nunca reinicia do zero (seção 11).
 */
const STEP_LABELS: Record<OnboardingStep, string> = {
  company: "Sua empresa",
  channel: "Canal",
  team: "Equipe",
  commercial: "Comercial",
  brand: "Marca",
  done: "Pronto",
};

const WIZARD_STEPS = ONBOARDING_STEPS.filter((step) => step !== "done");

export default function OnboardingWizardPage() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const workspace = useCurrentWorkspace();
  const { data: progress, isLoading, error, mutate } = useOnboarding(params.workspaceId);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!isLoading && progress === null && !starting) {
      setStarting(true);
      startOnboarding(params.workspaceId)
        .then(() => mutate())
        .finally(() => setStarting(false));
    }
  }, [isLoading, progress, starting, params.workspaceId, mutate]);

  useEffect(() => {
    // Workspace já concluído → Home. Único redirect automático desta rota — nunca o contrário
    // (nada redireciona PARA cá automaticamente, só o link no checklist da Home), então isto
    // nunca gera loop (seção 14).
    if (progress?.status === "completed") {
      router.replace(`/workspaces/${params.workspaceId}`);
    }
  }, [progress?.status, params.workspaceId, router]);

  const goHome = () => router.push(`/workspaces/${params.workspaceId}`);

  if (isLoading || starting || !progress) {
    if (error) {
      return (
        <div className="mx-auto max-w-xl px-4 py-16">
          <ErrorState error={error} onRetry={() => mutate()} />
        </div>
      );
    }
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  const stepIndex = WIZARD_STEPS.indexOf(progress.currentStep === "done" ? "brand" : progress.currentStep);
  const stepNumber = Math.min(stepIndex + 1, WIZARD_STEPS.length);

  async function refresh() {
    await mutate();
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-8 sm:py-12">
      <WizardHeader stepNumber={stepNumber} totalSteps={WIZARD_STEPS.length} onSaveAndExit={goHome} />

      <div className="mt-8 flex-1">
        {progress.currentStep === "company" ? <CompanyStep workspaceId={workspace.id} onAdvance={refresh} /> : null}
        {progress.currentStep === "channel" ? (
          <ChannelStep workspaceId={workspace.id} onAdvance={refresh} channelModuleEnabled={progress.channelModuleEnabled} />
        ) : null}
        {progress.currentStep === "team" ? <TeamStep workspaceId={workspace.id} onAdvance={refresh} /> : null}
        {progress.currentStep === "commercial" ? <CommercialStep workspaceId={workspace.id} onAdvance={refresh} /> : null}
        {progress.currentStep === "brand" ? <BrandStep workspaceId={workspace.id} onAdvance={refresh} /> : null}
        {progress.currentStep === "done" ? <DoneStep progress={progress} onFinish={goHome} workspaceId={workspace.id} /> : null}
      </div>
    </div>
  );
}

function WizardHeader({ stepNumber, totalSteps, onSaveAndExit }: { stepNumber: number; totalSteps: number; onSaveAndExit: () => void }) {
  const percent = Math.round((stepNumber / totalSteps) * 100);
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <Logo className="h-9 w-auto text-foreground" />
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Passo {stepNumber} de {totalSteps}
          </span>
          <Button variant="ghost" onClick={onSaveAndExit}>
            Salvar e sair
          </Button>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3 hidden grid-cols-5 gap-2 text-[11px] font-medium text-muted-foreground sm:grid">
        {["Empresa", "Canal", "Equipe", "Comercial", "Marca"].map((label, index) => (
          <span key={label} className={index + 1 <= stepNumber ? "text-foreground" : undefined}>{index + 1} {label}</span>
        ))}
      </div>
    </div>
  );
}

function StepCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardBody className="space-y-5 p-6 sm:p-7">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

const GOAL_LABEL: Record<OnboardingGoal, string> = {
  content: "Gerar conteúdo",
  support: "Atender clientes",
  sales: "Organizar vendas",
  all: "Tudo isso",
};

function CompanyStep({ workspaceId, onAdvance }: { workspaceId: string; onAdvance: () => Promise<void> }) {
  const workspace = useCurrentWorkspace();
  const [name, setName] = useState(workspace.name);
  const [segment, setSegment] = useState("");
  const [size, setSize] = useState("");
  const [goal, setGoal] = useState<OnboardingGoal | "">("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("Dê um nome para sua empresa antes de continuar.");
      return;
    }
    setBusy(true);
    try {
      if (name.trim() !== workspace.name) await updateWorkspace(workspaceId, { name: name.trim() });
      await saveOnboardingCompanyStep(workspaceId, { segment: segment || undefined, size: size || undefined, goal: goal || undefined });
      await onAdvance();
    } catch (err) {
      toast.error("Não foi possível salvar", { description: err instanceof Error ? err.message : "Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard title="Sua empresa" description="Só o essencial pra começar — você pode ajustar tudo isso depois.">
      <div>
        <Label htmlFor="company-name">Nome da empresa</Label>
        <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Imobiliária Vista Alegre" />
      </div>
      <div>
        <Label htmlFor="company-segment">Segmento</Label>
        <Select id="company-segment" value={segment} onValueChange={setSegment} placeholder="Selecione (opcional)">
          {[
            ["imobiliaria", "Imobiliária"],
            ["clinica", "Clínica"],
            ["agencia", "Agência"],
            ["software", "Software"],
            ["servicos", "Serviços"],
            ["varejo", "Varejo"],
            ["outro", "Outro"],
          ].map(([value, label]) => (
            <SelectItem key={value} value={value}>{label}</SelectItem>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="company-size">Tamanho da equipe (opcional)</Label>
        <Select id="company-size" value={size} onValueChange={setSize} placeholder="Selecione (opcional)">
          {["Só eu", "2-5", "6-20", "21-50", "50+"].map((label) => (
            <SelectItem key={label} value={label}>{label}</SelectItem>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="company-goal">Objetivo principal</Label>
        <Select id="company-goal" value={goal} onValueChange={(v) => setGoal(v as OnboardingGoal)} placeholder="Selecione (opcional)">
          {ONBOARDING_GOALS.map((value) => (
            <SelectItem key={value} value={value}>{GOAL_LABEL[value]}</SelectItem>
          ))}
        </Select>
      </div>
      <Button onClick={handleSubmit} disabled={busy} className="w-full">
        {busy ? "Salvando..." : "Continuar"}
      </Button>
    </StepCard>
  );
}

function ChannelStep({
  workspaceId,
  onAdvance,
  channelModuleEnabled,
}: {
  workspaceId: string;
  onAdvance: () => Promise<void>;
  channelModuleEnabled: boolean;
}) {
  const { data } = useInboxConnections(workspaceId);
  const [displayName, setDisplayName] = useState("WhatsApp Principal");
  const [busy, setBusy] = useState(false);
  const [qrCode, setQrCode] = useState<string | undefined>(undefined);
  const [connectionId, setConnectionId] = useState<string | undefined>(undefined);

  const existingConnection = data?.connections[0];

  async function handleConnect() {
    setBusy(true);
    try {
      const result = await connectChannelDuringOnboarding(workspaceId, displayName.trim() || "WhatsApp");
      setConnectionId(result.connection.id);
      const { qrCode: code } = await getInboxConnectionQrCode(workspaceId, result.connection.id);
      setQrCode(code);
    } catch (err) {
      toast.error("Não foi possível conectar o WhatsApp", { description: err instanceof Error ? err.message : "Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip() {
    setBusy(true);
    try {
      await advanceOnboardingStep(workspaceId, "channel", true);
      await onAdvance();
    } finally {
      setBusy(false);
    }
  }

  async function handleContinue() {
    setBusy(true);
    try {
      await advanceOnboardingStep(workspaceId, "channel", false);
      await onAdvance();
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard title="Por onde seus clientes falam com você?" description="Conecte o WhatsApp para começar a atender com contexto dentro do Vorix.">
      {existingConnection || connectionId ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">WhatsApp conectado — escaneie o código abaixo pelo app do WhatsApp do número que vai atender pelo Vorix.</p>
          {qrCode ? <QrPreview value={qrCode} /> : null}
          <Button onClick={handleContinue} disabled={busy} className="w-full">Continuar</Button>
        </div>
      ) : channelModuleEnabled ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="channel-name">Nome desta conexão</Label>
            <Input id="channel-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ex.: WhatsApp Comercial" />
          </div>
          <Button onClick={handleConnect} disabled={busy} className="w-full">
            {busy ? "Conectando..." : "Conectar WhatsApp"}
          </Button>
          <Button variant="ghost" onClick={handleSkip} disabled={busy} className="w-full">
            Pular por enquanto
          </Button>
          <p className="text-xs text-muted-foreground">O Conversas só começa a funcionar de verdade depois que um canal for conectado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A conexão de canais está temporariamente indisponível neste ambiente. Você pode continuar o onboarding normalmente e conectar o WhatsApp assim que estiver disponível.
          </p>
          <Button onClick={handleSkip} disabled={busy} className="w-full">Continuar</Button>
        </div>
      )}
    </StepCard>
  );
}

function QrPreview({ value }: { value: string }) {
  const looksLikeImage = value.startsWith("data:image") || value.startsWith("http://") || value.startsWith("https://");
  return (
    <div className="rounded-xl border border-border bg-background p-4 text-center">
      {looksLikeImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="QR Code para conectar WhatsApp" className="mx-auto h-56 w-56 rounded-lg bg-white object-contain p-2" />
      ) : (
        <div className="mx-auto flex min-h-40 max-w-sm items-center justify-center rounded-lg border border-dashed border-border bg-muted/35 px-4 py-6 text-sm text-muted-foreground">
          Código de pareamento recebido. Copie pelo fluxo do WhatsApp quando solicitado.
        </div>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<TenantRole, string> = { owner: "Administrador", admin: "Gestor", editor: "Editor", viewer: "Visualizador" };

function TeamStep({ workspaceId, onAdvance }: { workspaceId: string; onAdvance: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("editor");
  const [invited, setInvited] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const result = await inviteTeamMemberDuringOnboarding(workspaceId, trimmed, role);
      setInvited((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
      setEmail("");
      toast.success(result.alreadyPending ? "Convite já estava pendente." : "Convite enviado.");
    } catch (err) {
      toast.error("Não foi possível convidar", { description: err instanceof Error ? err.message : "Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  async function handleContinue(skipped: boolean) {
    setBusy(true);
    try {
      await advanceOnboardingStep(workspaceId, "team", skipped);
      await onAdvance();
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard title="Convide sua equipe" description="Convide quantas pessoas quiser por e-mail, cada uma com seu papel de acesso — cada convidado recebe um link para entrar no Vorix. (Times nomeados, como “Comercial” ou “Atendimento”, podem ser organizados depois em Configurações.)">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@empresa.com" className="flex-1" />
        <Select value={role} onValueChange={(v) => setRole(v as TenantRole)} className="sm:w-40">
          {(["admin", "editor", "viewer"] as TenantRole[]).map((r) => (
            <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
          ))}
        </Select>
        <Button variant="secondary" onClick={handleInvite} disabled={busy || !email.trim()}>Convidar</Button>
      </div>
      {invited.length > 0 ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {invited.map((sent) => (
            <li key={sent} className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" /> {sent}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button onClick={() => handleContinue(invited.length === 0)} disabled={busy} className="w-full">Continuar</Button>
        {invited.length === 0 ? (
          <Button variant="ghost" onClick={() => handleContinue(true)} disabled={busy} className="w-full">Pular por enquanto</Button>
        ) : null}
      </div>
    </StepCard>
  );
}

function CommercialStep({ workspaceId, onAdvance }: { workspaceId: string; onAdvance: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function handleContinue() {
    setBusy(true);
    try {
      await advanceOnboardingStep(workspaceId, "commercial", false);
      await onAdvance();
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard title="Seu funil comercial está pronto" description="Todo workspace novo já nasce com um pipeline de vendas configurado.">
      <ul className="space-y-1.5 text-sm text-foreground">
        {["Novo Lead", "Contato Feito", "Proposta Enviada", "Negociação", "Ganho", "Perdido"].map((stage) => (
          <li key={stage} className="flex items-center gap-2">
            <Circle className="h-3 w-3 text-primary" fill="currentColor" /> {stage}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <Button onClick={handleContinue} disabled={busy} className="w-full">Usar este funil</Button>
        <Button variant="ghost" disabled={busy} className="w-full" onClick={() => window.open(`/workspaces/${workspaceId}/deals`, "_blank")}>
          Personalizar depois no CRM
        </Button>
      </div>
    </StepCard>
  );
}

function BrandStep({ workspaceId, onAdvance }: { workspaceId: string; onAdvance: () => Promise<void> }) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(skipped: boolean) {
    setBusy(true);
    try {
      if (!skipped && description.trim()) {
        await apiClient.post("/v1/brand-profile", { workspaceId, businessDescription: description.trim() });
      }
      await advanceOnboardingStep(workspaceId, "brand", skipped || !description.trim());
      await onAdvance();
    } catch (err) {
      toast.error("Não foi possível salvar a marca", { description: err instanceof Error ? err.message : "Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard title="Vamos ensinar sua marca ao Vorix" description="Só uma descrição curta por agora — o resto fica na Central de Marca, quando você quiser.">
      <div>
        <Label htmlFor="brand-description">Sobre o seu negócio</Label>
        <Textarea id="brand-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Ex.: Ajudamos famílias a encontrar o imóvel certo na Zona Sul." />
      </div>
      <div className="flex flex-col gap-2">
        <Button onClick={() => handleSubmit(false)} disabled={busy} className="w-full">Configurar agora</Button>
        <Button variant="ghost" onClick={() => handleSubmit(true)} disabled={busy} className="w-full">Pular por enquanto</Button>
      </div>
    </StepCard>
  );
}

function DoneStep({ progress, onFinish, workspaceId }: { progress: { completedSteps: OnboardingStep[] }; onFinish: () => void; workspaceId: string }) {
  const [busy, setBusy] = useState(false);
  const checklist = useMemo(
    () => [
      { step: "company" as const, label: "Empresa configurada" },
      { step: "commercial" as const, label: "Comercial pronto" },
      { step: "team" as const, label: "Equipe convidada" },
      { step: "channel" as const, label: "WhatsApp conectado" },
      { step: "brand" as const, label: "Marca configurada" },
    ],
    [],
  );

  async function handleFinish() {
    setBusy(true);
    try {
      await completeOnboarding(workspaceId);
      onFinish();
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepCard title="Seu Vorix está pronto." description="Você pode completar o que ficou pendente a qualquer momento, direto pela Home.">
      <ul className="space-y-2 text-sm">
        {checklist.map((item) => {
          const done = progress.completedSteps.includes(item.step);
          return (
            <li key={item.step} className="flex items-center gap-2">
              {done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
              <span className={done ? "text-foreground" : "text-muted-foreground"}>{item.label}{done ? "" : " — pode ser completado depois"}</span>
            </li>
          );
        })}
      </ul>
      <Button onClick={handleFinish} disabled={busy} className="w-full">
        Ir para o Vorix
      </Button>
    </StepCard>
  );
}
