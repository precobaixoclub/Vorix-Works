"use client";

import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Spinner } from "@/components/Spinner";

export type OAuthCallbackState = "loading" | "success" | "error";

export function OAuthCallbackPanel({
  state,
  message,
  returnHref,
}: {
  state: OAuthCallbackState;
  message: string;
  returnHref?: string;
}) {
  const href = returnHref || "/workspaces";
  return (
    <main className="mx-auto flex max-w-lg flex-col items-center px-3 py-12 sm:px-6 sm:py-20">
      <Card className="flex w-full flex-col items-center gap-4 p-5 text-center sm:p-8">
        {state === "loading" || state === "success" ? <Spinner /> : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-lg text-red-600">!</span>}
        <div>
          <h1 className="text-lg font-semibold text-ink">{state === "error" ? "Não foi possível concluir a conexão" : state === "success" ? "Conexão concluída" : "Conectando"}</h1>
          <p className="mt-2 text-sm text-ink-muted">{message}</p>
        </div>
        {state === "error" ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <Link href={href}><Button variant="secondary" className="w-full sm:w-auto">Voltar para Conexões</Button></Link>
            <Link href={href}><Button className="w-full sm:w-auto">Tentar novamente</Button></Link>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
