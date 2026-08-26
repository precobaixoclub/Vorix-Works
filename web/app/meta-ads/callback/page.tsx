"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { completeMetaAdsOAuth } from "@/features/meta-ads/api";
import { OAuthCallbackPanel, type OAuthCallbackState } from "@/features/oauth/OAuthCallbackPanel";

export const META_ADS_RETURN_PATH_KEY = "meta-ads:return-path";

function MetaAdsOAuthCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { state: authState } = useAuth();
  const [message, setMessage] = useState("Conectando a conta de anúncios do Meta...");
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
      setMessage("Sessão do Vorix expirada. Entre novamente e tente conectar o Meta Ads outra vez.");
      return;
    }

    if (started.current) return;
    started.current = true;

    const returnPath = window.sessionStorage.getItem(META_ADS_RETURN_PATH_KEY);
    setReturnHref(returnPath ?? undefined);
    const back = () => {
      window.sessionStorage.removeItem(META_ADS_RETURN_PATH_KEY);
      if (returnPath) router.replace(returnPath);
    };

    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");

    if (error) {
      setCallbackState("error");
      setMessage(`O Meta recusou a autorização: ${params.get("error_description") ?? error}`);
      return;
    }

    if (!code || !state) {
      setCallbackState("error");
      setMessage("Callback inválido: code ou state ausente.");
      return;
    }

    completeMetaAdsOAuth(state, code)
      .then((result) => {
        setCallbackState("success");
        setMessage(result.accounts.length > 0 ? `${result.accounts.length} conta(s) de anúncio encontrada(s). Redirecionando...` : "Conectado. Nenhuma conta de anúncio encontrada nesse login.");
        back();
      })
      .catch((cause: unknown) => {
        setCallbackState("error");
        setMessage(cause instanceof Error ? cause.message : "Não foi possível concluir a conexão com o Meta Ads.");
      });
  }, [authState.status, params, router]);

  return <OAuthCallbackPanel state={callbackState} message={message} returnHref={returnHref} />;
}

export default function MetaAdsOAuthCallbackPage() {
  return (
    <Suspense fallback={<OAuthCallbackPanel state="loading" message="Conectando a conta de anúncios do Meta..." />}>
      <MetaAdsOAuthCallbackContent />
    </Suspense>
  );
}
