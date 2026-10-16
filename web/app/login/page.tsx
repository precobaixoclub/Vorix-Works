"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField, AuthShell } from "@/components/public/AuthShell";
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
      setError(err instanceof ApiError ? translateLoginError(err) : "Não foi possível conectar ao Vorix. Verifique sua conexão e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell eyebrow="Bem-vindo de volta" title="Entre para continuar sua operação." description="Conversas, reuniões e próximos passos da sua empresa, na mesma conta.">
      <h2>Entrar no Vorix</h2>
      <p className="public-auth-sub">Use o e-mail e a senha da sua conta.</p>
      <form onSubmit={handleSubmit} className="public-auth-form">
        <AuthField id="login-email" label="E-mail" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" autoFocus />
        <AuthField id="login-password" label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" />
        {error ? <p className="public-auth-error" role="alert">{error}</p> : null}
        <button type="submit" className="public-button primary" disabled={submitting}>{submitting ? "Entrando..." : "Entrar"}</button>
      </form>
      <p className="public-auth-switch">Ainda não tem conta? <Link href="/signup">Criar conta</Link></p>
    </AuthShell>
  );
}

/** Nunca mostra código interno da API para quem está entrando. */
function translateLoginError(err: ApiError): string {
  if (err.message.includes("INVALID_CREDENTIALS") || err.statusCode === 401) return "E-mail ou senha incorretos.";
  if (err.statusCode === 429) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  const text = err.message.replace(/^[A-Z0-9_]+:\s*/, "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Não foi possível entrar. Tente novamente.";
}
