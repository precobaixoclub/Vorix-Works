"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthFallback, AuthField, AuthShell } from "@/components/public/AuthShell";
import { useAuth } from "@/contexts/auth-context";
import { listWorkspaces } from "@/features/workspace/api";
import { ApiError } from "@/lib/api-client";
import { trackProductEvent } from "@/lib/product-events";

export default function SignupPage() {
  return (
    <Suspense fallback={<AuthFallback label="Carregando cadastro..." />}>
      <SignupForm />
    </Suspense>
  );
}

const VALID_PLAN_CODES = ["START", "PRO", "BUSINESS"] as const;
type ValidPlanCode = (typeof VALID_PLAN_CODES)[number];

const PLAN_LABEL: Record<ValidPlanCode, string> = { START: "Start", PRO: "Pro", BUSINESS: "Business" };

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signup } = useAuth();
  const rawPlan = searchParams.get("plan");
  // Nunca envia um plano desconhecido/FREE pro backend (que rejeitaria) — sem plano reconhecido,
  // o cadastro segue normal, só sem trial automático (mesmo estado de sempre).
  const selectedPlan = VALID_PLAN_CODES.includes(rawPlan as ValidPlanCode) ? (rawPlan as ValidPlanCode) : undefined;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    trackProductEvent("signup_started", selectedPlan ? { planKey: selectedPlan } : undefined);
    try {
      await signup({ email: email.trim(), password, name: name.trim() || nameFromEmail(email), planCode: selectedPlan });
      // Nunca leva pro Billing (seção 27 do pedido) — mesmo quem escolheu um plano pago já saiu do
      // signup com o trial rodando (sem cartão). O caminho é sempre o onboarding.
      const workspaces = await listWorkspaces().catch(() => []);
      if (workspaces[0]) router.push(`/workspaces/${workspaces[0].id}/onboarding`);
      else router.push("/workspaces");
    } catch (err) {
      setError(err instanceof ApiError ? translateSignupError(err) : "Não foi possível criar a conta. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell eyebrow="Comece agora" title="Crie sua conta Vorix." description="Comece com Conversas e ajuste usuários e números conforme sua operação cresce.">
      <h2>Criar conta</h2>
      {selectedPlan ? (
        <p className="public-auth-sub">Plano <strong>{PLAN_LABEL[selectedPlan]}</strong> · 7 dias de teste, sem cartão · <Link href="/precos#monte">Trocar</Link></p>
      ) : (
        <p className="public-auth-sub">Teste o Vorix por 7 dias, sem cartão.</p>
      )}
      <form onSubmit={handleSubmit} className="public-auth-form">
        <AuthField id="signup-name" label="Nome" type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" autoFocus />
        <AuthField id="signup-email" label="E-mail" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" />
        <AuthField id="signup-password" label="Senha" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 8 caracteres" />
        {error ? <p className="public-auth-error" role="alert">{error}</p> : null}
        <button type="submit" className="public-button primary" disabled={submitting}>{submitting ? "Criando conta..." : "Criar conta"}</button>
      </form>
      <p className="public-auth-switch">Já tem conta? <Link href="/login">Entrar</Link></p>
    </AuthShell>
  );
}

function nameFromEmail(email: string) {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  return local ? local.replace(/\b\w/g, (char) => char.toUpperCase()) : "Usuário Vorix";
}

function translateSignupError(err: ApiError): string {
  if (err.code === "CONFLICT" || err.message.includes("SIGNUP_EMAIL_ALREADY_REGISTERED") || err.message.includes("USER_EMAIL_ALREADY_EXISTS")) return "Já existe uma conta com este e-mail. Faça login.";
  if (err.code === "VALIDATION_ERROR" || err.message.includes("IDENTITY_VALIDATION_ERROR")) return "Verifique os dados e tente novamente. A senha precisa ter pelo menos 8 caracteres.";
  return err.message || "Não foi possível criar a conta.";
}
