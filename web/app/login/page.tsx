"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { Input, Label } from "@/components/Field";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api-client";

/**
 * Login real — Sprint 05 (Fase 5), substitui o login fake (DEV_PRINCIPAL, Sprint 04). Email +
 * senha contra `POST /v1/auth/login`; nenhum campo/estado de sessão é gerenciado aqui além de
 * delegar para `useAuth().login`, que cuida de token em memória + cookies + agendamento de
 * renovação automática.
 */
export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await login(email.trim(), password);
      router.push("/workspaces");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível entrar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <Card className="w-full max-w-sm">
        <CardBody className="flex flex-col gap-5 py-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Logo className="h-16 w-auto text-ink" />
            <div>
              <h1 className="text-base font-semibold text-ink">Entrar no Vorix</h1>
              <p className="mt-1 text-sm text-ink-muted">Use o email e senha da sua conta.</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}
