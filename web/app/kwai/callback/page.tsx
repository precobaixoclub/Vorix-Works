"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/Card";
import { Spinner } from "@/components/Spinner";
import { completeKwaiOAuth } from "@/features/kwai/api";

/** Chave de sessão — a tela que iniciou o connect grava o próprio caminho aqui antes de redirecionar pro Kwai. */
export const KWAI_RETURN_PATH_KEY = "kwai:return-path";

function KwaiOAuthCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [message, setMessage] = useState("Conectando a conta do Kwai...");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const returnPath = window.sessionStorage.getItem(KWAI_RETURN_PATH_KEY);
    const back = () => {
      window.sessionStorage.removeItem(KWAI_RETURN_PATH_KEY);
      if (returnPath) router.replace(returnPath);
    };

    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");
    if (error) {
      setMessage(`O Kwai recusou a autorização: ${params.get("error_description") ?? error}`);
      return;
    }
    if (!code || !state) {
      setMessage("Callback inválido: code ou state ausente.");
      return;
    }

    completeKwaiOAuth(state, code)
      .then((result) => {
        setMessage(`Conta ${result.displayName ?? result.providerSubjectId} conectada. Redirecionando...`);
        back();
      })
      .catch((cause: unknown) => {
        setMessage(cause instanceof Error ? cause.message : "Não foi possível concluir a conexão com o Kwai.");
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
 * Destino do `redirect_uri` do Kwai. A página só repassa `code`/`state` para a API já
 * autenticada — o token de acesso nunca é manipulado pelo navegador.
 */
export default function KwaiOAuthCallbackPage() {
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
      <KwaiOAuthCallbackContent />
    </Suspense>
  );
}
