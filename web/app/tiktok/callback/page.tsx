"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { finishSocialOAuth, takeSocialOAuthFlow } from "@/features/social/oauth-callback";
import { OAuthCallbackPanel, type OAuthCallbackState } from "@/features/oauth/OAuthCallbackPanel";
import { completeTikTokOAuth } from "@/features/tiktok/api";

export const TIKTOK_RETURN_PATH_KEY = "tiktok:return-path";

function TikTokOAuthCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { state: authState } = useAuth();
  const [message, setMessage] = useState("Conectando a conta do TikTok...");
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
      setMessage("Sessão do Vorix expirada. Entre novamente e tente conectar o TikTok outra vez.");
      return;
    }

    if (started.current) return;
    started.current = true;
    // Consumida já no início: um retorno com erro também encerra o fluxo social pendente.
    const socialNetwork = takeSocialOAuthFlow();

    const returnPath = window.sessionStorage.getItem(TIKTOK_RETURN_PATH_KEY);
    setReturnHref(returnPath ?? undefined);
    const back = () => {
      window.sessionStorage.removeItem(TIKTOK_RETURN_PATH_KEY);
      if (returnPath) router.replace(returnPath);
    };

    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");

    if (error) {
      setCallbackState("error");
      setMessage(`O TikTok recusou a autorização: ${params.get("error_description") ?? error}`);
      return;
    }

    if (!code || !state) {
      setCallbackState("error");
      setMessage("Callback inválido: code ou state ausente.");
      return;
    }

    // Fluxo das Redes sociais do Marketing: conclui pela rota social (state persistido e vinculado
    // ao usuário) e volta para a tela de Integrações, abrindo a escolha de contas quando houver várias.
    if (socialNetwork) {
      finishSocialOAuth(socialNetwork, state, code)
        .then((target) => {
          setCallbackState("success");
          setMessage("Conta conectada. Redirecionando...");
          router.replace(target);
        })
        .catch((cause: unknown) => {
          setCallbackState("error");
          setMessage(cause instanceof Error ? cause.message : "Não foi possível concluir a conexão.");
        });
      return;
    }

    completeTikTokOAuth(state, code)
      .then((result) => {
        setCallbackState("success");
        setMessage(`Conta ${result.displayName ?? result.providerSubjectId} conectada. Redirecionando...`);
        back();
      })
      .catch((cause: unknown) => {
        setCallbackState("error");
        setMessage(cause instanceof Error ? cause.message : "Não foi possível concluir a conexão com o TikTok.");
      });
  }, [authState.status, params, router]);

  return <OAuthCallbackPanel state={callbackState} message={message} returnHref={returnHref} />;
}

export default function TikTokOAuthCallbackPage() {
  return (
    <Suspense fallback={<OAuthCallbackPanel state="loading" message="Conectando a conta do TikTok..." />}>
      <TikTokOAuthCallbackContent />
    </Suspense>
  );
}
