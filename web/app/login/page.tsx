"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField, AuthShell } from "@/components/public/AuthShell";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api-client";
import { PUBLIC_CONTACT } from "@/features/public-site/catalog";

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
        <AuthField id="login-email" label="E-mail" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com" autoFocus errorId={error ? "login-error" : undefined} />
        <AuthField id="login-password" label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" errorId={error ? "login-error" : undefined} />
        {error ? <p id="login-error" className="public-auth-error" role="alert">{error}</p> : null}
        <button type="submit" className="public-button primary" disabled={submitting}>{submitting ? "Entrando..." : "Entrar"}</button>
      </form>
      {/* Fase 13: não há redefinição de senha automática no backend — a tela diz o caminho real. */}
      <details className="public-auth-help">
        <summary>Esqueceu a senha?</summary>
        <p>A redefinição de senha ainda não é feita por aqui. Se a sua conta foi criada por um administrador da empresa, peça a ele. Se você é o responsável pela conta, escreva para <a href={PUBLIC_CONTACT}>comercial@vorixworks.com</a> a partir do e-mail cadastrado.</p>
      </details>
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
