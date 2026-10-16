"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { completeZoom, ZOOM_RETURN_KEY } from "@/components/meetings/ZoomIntegrationCard";
import { OAuthCallbackPanel, type OAuthCallbackState } from "@/features/oauth/OAuthCallbackPanel";

/** Retorno do OAuth do Zoom (Vorix Meetings). O `state` é assinado e conferido no backend contra a
 * pessoa logada. */
function ZoomCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { state: authState } = useAuth();
  const [message, setMessage] = useState("Conectando o Zoom...");
  const [callbackState, setCallbackState] = useState<OAuthCallbackState>("loading");
  const [returnHref, setReturnHref] = useState<string | undefined>();
  const started = useRef(false);

  useEffect(() => {
    if (authState.status === "loading") return;
    if (authState.status === "unauthenticated") {
      setCallbackState("error");
      setMessage("Sessão do Vorix expirada. Entre novamente e conecte o Zoom outra vez.");
      return;
    }
    if (started.current) return;
    started.current = true;
    const returnPath = window.sessionStorage.getItem(ZOOM_RETURN_KEY);
    setReturnHref(returnPath ?? undefined);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setCallbackState("error");
      setMessage("Retorno inválido do Zoom: falta o código de autorização.");
      return;
    }
    completeZoom(state, code)
      .then((result) => {
        setCallbackState("success");
        setMessage(`Zoom ${result.email ?? ""} conectado. Redirecionando...`);
        window.sessionStorage.removeItem(ZOOM_RETURN_KEY);
        router.replace(returnPath ?? `/workspaces/${result.workspaceId}/meetings/integrations`);
      })
      .catch((cause: unknown) => {
        setCallbackState("error");
        setMessage(cause instanceof Error ? cause.message : "Não foi possível concluir a conexão com o Zoom.");
      });
  }, [authState.status, params, router]);

  return <OAuthCallbackPanel state={callbackState} message={message} returnHref={returnHref} />;
}

export default function ZoomCallbackPage() {
  return (
    <Suspense fallback={<OAuthCallbackPanel state="loading" message="Conectando o Zoom..." />}>
      <ZoomCallbackContent />
    </Suspense>
  );
}
