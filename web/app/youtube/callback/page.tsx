"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { OAuthCallbackPanel, type OAuthCallbackState } from "@/features/oauth/OAuthCallbackPanel";
import { completeYouTubeOAuth } from "@/features/youtube/api";

export const YOUTUBE_RETURN_PATH_KEY = "youtube:return-path";

function YouTubeOAuthCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { state: authState } = useAuth();
  const [message, setMessage] = useState("Conectando o canal do YouTube...");
  const [callbackState, setCallbackState] = useState<OAuthCallbackState>("loading");
  const [returnHref, setReturnHref] = useState<string | undefined>();
  const started = useRef(false);

  useEffect(() => {
    if (authState.status === "loading") {
      setCallbackState("loading");
      setMessage("Autenticando sessão do Vorix...");
      return;
    }

    if (authState.status === "unauthenticated") {
      setCallbackState("error");
      setMessage("Sessão do Vorix expirada. Entre novamente e tente conectar o YouTube outra vez.");
      return;
    }

    if (started.current) return;
    started.current = true;

    const returnPath = window.sessionStorage.getItem(YOUTUBE_RETURN_PATH_KEY);
    setReturnHref(returnPath ?? undefined);
    const back = () => {
      window.sessionStorage.removeItem(YOUTUBE_RETURN_PATH_KEY);
      if (returnPath) router.replace(returnPath);
    };

    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");

    if (error) {
      setCallbackState("error");
      setMessage(`O Google recusou a autorização: ${params.get("error_description") ?? error}`);
      return;
    }

    if (!code || !state) {
      setCallbackState("error");
      setMessage("Callback inválido: code ou state ausente.");
      return;
    }

    completeYouTubeOAuth(state, code)
      .then((result) => {
        setCallbackState("success");
        setMessage(`Canal ${result.displayName ?? result.providerSubjectId} conectado. Redirecionando...`);
        back();
      })
      .catch((cause: unknown) => {
        setCallbackState("error");
        setMessage(cause instanceof Error ? cause.message : "Não foi possível concluir a conexão com o YouTube.");
      });
  }, [authState.status, params, router]);

  return <OAuthCallbackPanel state={callbackState} message={message} returnHref={returnHref} />;
}

export default function YouTubeOAuthCallbackPage() {
  return (
    <Suspense fallback={<OAuthCallbackPanel state="loading" message="Conectando o canal do YouTube..." />}>
      <YouTubeOAuthCallbackContent />
    </Suspense>
  );
}
