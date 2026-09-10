"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { Input, Label } from "@/components/Field";
import { Logo } from "@/components/Logo";
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

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signup } = useAuth();
  const selectedPlan = searchParams.get("plan");
  const wantsPaidPlan = Boolean(selectedPlan && selectedPlan !== "FREE");
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
      await signup({ email: email.trim(), password, name: nameFromEmail(email), workspaceName: undefined });
      const workspaces = await listWorkspaces().catch(() => []);
      if (workspaces[0] && wantsPaidPlan) router.push(`/workspaces/${workspaces[0].id}/settings/plano`);
      else if (workspaces[0]) router.push(`/workspaces/${workspaces[0].id}/onboarding`);
      else router.push("/workspaces");
    } catch (err) {
      setError(err instanceof ApiError ? translateSignupError(err) : "Não foi possível criar a conta. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-background px-4 py-8 text-foreground lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)] lg:p-0">
      <section className="hidden border-r border-border bg-muted/20 p-10 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" aria-label="Vorix"><Logo className="h-11 w-auto text-foreground" /></Link>
        <div className="max-w-xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Do marketing à venda</p>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight">Entre em uma operação conectada por IA.</h1>
          <p className="mt-4 text-muted-foreground">Crie a conta, passe pelo onboarding e comece pelo Command Center.</p>
        </div>
      </section>
      <section className="flex items-center justify-center">
        <Card className="w-full max-w-sm">
          <CardBody className="flex flex-col gap-5 py-8">
            <div className="text-center">
              <Logo className="mx-auto h-12 w-auto text-foreground lg:hidden" />
              <h2 className="mt-4 text-xl font-semibold">{wantsPaidPlan ? "Criar conta" : "Começar no Vorix"}</h2>
              {selectedPlan ? <p className="mt-2 text-sm text-muted-foreground">Plano selecionado: <span className="font-medium text-foreground">{selectedPlan}</span> · <Link href="/pricing" className="text-primary hover:underline">Alterar</Link></p> : null}
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="signup-email">E-mail</Label>
                <Input id="signup-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" autoFocus />
              </div>
              <div>
                <Label htmlFor="signup-password">Senha</Label>
                <Input id="signup-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 8 caracteres" />
              </div>
              {error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Criando conta..." : "Criar conta"}</Button>
            </form>
            <p className="text-center text-xs text-muted-foreground">Já tem conta? <Link href="/login" className="font-medium text-primary hover:underline">Entrar</Link></p>
          </CardBody>
        </Card>
      </section>
    </main>
  );
}

function AuthFallback({ label }: { label: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm"><CardBody className="flex flex-col items-center gap-3 py-8 text-center"><Logo className="h-14 w-auto text-foreground" /><p className="text-sm text-muted-foreground">{label}</p></CardBody></Card>
    </main>
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
