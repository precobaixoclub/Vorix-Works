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
    <main className="grid min-h-dvh bg-background px-4 py-8 text-foreground lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)] lg:p-0">
      <section className="hidden border-r border-border bg-muted/20 p-10 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" aria-label="Vorix"><Logo className="h-11 w-auto text-foreground" /></Link>
        <div className="max-w-xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Bem-vindo de volta</p>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight">Entre para continuar sua operação.</h1>
          <p className="mt-4 text-muted-foreground">Marketing, atendimento, CRM e resultados no mesmo lugar.</p>
        </div>
      </section>
      <section className="flex items-center justify-center">
        <Card className="w-full max-w-sm">
          <CardBody className="flex flex-col gap-5 py-8">
            <div className="text-center">
              <Logo className="mx-auto h-12 w-auto text-foreground lg:hidden" />
              <h2 className="mt-4 text-xl font-semibold">Entrar no Vorix</h2>
              <p className="mt-1 text-sm text-muted-foreground">Use o e-mail e a senha da sua conta.</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="login-email">E-mail</Label>
                <Input id="login-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" autoFocus />
              </div>
              <div>
                <Label htmlFor="login-password">Senha</Label>
                <Input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" />
              </div>
              {error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Entrando..." : "Entrar"}</Button>
            </form>
            <p className="text-center text-xs text-muted-foreground">Ainda não tem conta? <Link href="/signup" className="font-medium text-primary hover:underline">Criar conta</Link></p>
          </CardBody>
        </Card>
      </section>
    </main>
  );
}
