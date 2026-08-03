"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/Card";
import { Spinner } from "@/components/Spinner";
import { completeMetaOAuth } from "@/features/meta/api";

/** Chave de sessão compartilhada — tanto a tela do Instagram quanto a da Página do Facebook
 * gravam o próprio caminho aqui antes de redirecionar pro Meta, já que os dois usam o mesmo
 * fluxo OAuth (uma conexão resolve Instagram e Página juntos). */
export const META_RETURN_PATH_KEY = "meta:return-path";

function MetaOAuthCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState("Conectando a conta do Meta...");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const returnPath = window.sessionStorage.getItem(META_RETURN_PATH_KEY);
    const back = () => {
      window.sessionStorage.removeItem(META_RETURN_PATH_KEY);
      if (returnPath) router.replace(returnPath);
    };

    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");
    if (error) {
      setMessage(`O Meta recusou a autorização: ${params.get("error_description") ?? error}`);
      return;
    }
    if (!code || !state) {
      setMessage("Callback inválido: code ou state ausente.");
      return;
    }

    completeMetaOAuth(state, code)
      .then((result) => {
        const names = result.accounts.map((account) => account.displayName ?? account.providerSubjectId).join(", ");
        setMessage(result.accounts.length > 0 ? `Conectado: ${names}. Redirecionando...` : "Conta conectada. Redirecionando...");
        back();
      })
      .catch((cause: unknown) => {
        setMessage(cause instanceof Error ? cause.message : "Não foi possível concluir a conexão com o Meta.");
      });
  }, [params, router]);

  return (
    <main className="mx-auto flex max-w-lg flex-col items-center px-6 py-20">
      <Card className="flex w-full flex-col items-center gap-4 p-8">
        <Spinner />
        <p className="text-center text-sm text-ink">{message}</p>
      </Card>
    </main>
  );
}

/**
 * Destino do `redirect_uri` do Meta. A página só repassa `code`/`state` para a API já
 * autenticada — o token de acesso nunca é manipulado pelo navegador.
 */
export default function MetaOAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex max-w-lg flex-col items-center px-6 py-20">
          <Card className="flex w-full flex-col items-center gap-4 p-8">
            <Spinner />
          </Card>
        </main>
      }
    >
      <MetaOAuthCallbackContent />
    </Suspense>
  );
}
