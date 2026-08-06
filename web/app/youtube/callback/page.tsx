"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/Card";
import { Spinner } from "@/components/Spinner";
import { useAuth } from "@/contexts/auth-context";
import { completeYouTubeOAuth } from "@/features/youtube/api";

export const YOUTUBE_RETURN_PATH_KEY = "youtube:return-path";

function YouTubeOAuthCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { state: authState } = useAuth();
  const [message, setMessage] = useState("Conectando o canal do YouTube...");
  const started = useRef(false);

  useEffect(() => {
    if (authState.status === "loading") {
      setMessage("Autenticando sessão do Vorix...");
      return;
    }
    if (authState.status === "unauthenticated") {
      setMessage("Sessão do Vorix expirada. Entre novamente e tente conectar o YouTube outra vez.");
      return;
    }
    if (started.current) return;
    started.current = true;

    const returnPath = window.sessionStorage.getItem(YOUTUBE_RETURN_PATH_KEY);
    const back = () => {
      window.sessionStorage.removeItem(YOUTUBE_RETURN_PATH_KEY);
      if (returnPath) router.replace(returnPath);
    };

    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");
    if (error) {
      setMessage(`O Google recusou a autorização: ${params.get("error_description") ?? error}`);
      return;
    }
    if (!code || !state) {
      setMessage("Callback inválido: code ou state ausente.");
      return;
    }

    completeYouTubeOAuth(state, code)
      .then((result) => {
        setMessage(`Canal ${result.displayName ?? result.providerSubjectId} conectado. Redirecionando...`);
        back();
      })
      .catch((cause: unknown) => {
        setMessage(cause instanceof Error ? cause.message : "Não foi possível concluir a conexão com o YouTube.");
      });
  }, [authState.status, params, router]);

  return (
    <main className="mx-auto flex max-w-lg flex-col items-center px-6 py-20">
      <Card className="flex w-full flex-col items-center gap-4 p-8">
        <Spinner />
        <p className="text-center text-sm text-ink">{message}</p>
      </Card>
    </main>
  );
}

export default function YouTubeOAuthCallbackPage() {
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
      <YouTubeOAuthCallbackContent />
    </Suspense>
  );
}
