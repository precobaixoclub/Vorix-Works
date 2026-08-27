"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { Input, Label } from "@/components/Field";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api-client";

/**
 * Cadastro público — Fase 2 do rollout B2C. POST /v1/auth/signup cria User + Tenant + Workspace
 * + tenant_billing FREE em uma única chamada e devolve o mesmo envelope de /auth/login já
 * autenticado; o AuthProvider (`contexts/auth-context.tsx`) trata como se fosse login normal.
 */
export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await signup({
        email: email.trim(),
        password,
        name: name.trim(),
        workspaceName: workspaceName.trim() || undefined,
      });
      router.push("/workspaces");
    } catch (err) {
      const message = err instanceof ApiError
        ? translateSignupError(err)
        : "Não foi possível criar a conta. Tente novamente.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardBody className="flex flex-col gap-5 py-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Logo className="h-16 w-auto text-ink" />
            <div>
              <h1 className="text-base font-semibold text-ink">Crie sua conta grátis</h1>
              <p className="mt-1 text-sm text-ink-muted">Plano FREE com 100 mil tokens de IA por mês.</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="name">Seu nome</Label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                required
                minLength={1}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como devemos te chamar"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
              />
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div>
              <Label htmlFor="workspaceName">Nome do workspace (opcional)</Label>
              <Input
                id="workspaceName"
                type="text"
                maxLength={120}
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Minha agência, Meu projeto…"
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Criando conta…" : "Criar conta grátis"}
            </Button>
            <p className="text-center text-xs text-ink-muted">
              Já tem conta?{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Entrar
              </Link>
            </p>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}

function translateSignupError(err: ApiError): string {
  if (err.code === "CONFLICT" || err.message.includes("SIGNUP_EMAIL_ALREADY_REGISTERED") || err.message.includes("USER_EMAIL_ALREADY_EXISTS")) {
    return "Já existe uma conta com este email. Faça login.";
  }
  if (err.code === "VALIDATION_ERROR" || err.message.includes("IDENTITY_VALIDATION_ERROR")) {
    return "Verifique os dados e tente novamente. A senha precisa ter pelo menos 8 caracteres.";
  }
  return err.message || "Não foi possível criar a conta.";
}
