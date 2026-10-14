"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { completeGoogleCalendar, GOOGLE_CALENDAR_RETURN_KEY } from "@/features/meetings/agenda";
import { OAuthCallbackPanel, type OAuthCallbackState } from "@/features/oauth/OAuthCallbackPanel";

/** Retorno do OAuth do Google Calendar (Vorix Meetings). O `state` é assinado e conferido no backend
 * contra a pessoa logada — uma autorização iniciada por outra conta é recusada. */
function GoogleCalendarCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { state: authState } = useAuth();
  const [message, setMessage] = useState("Conectando o Google Calendar...");
  const [callbackState, setCallbackState] = useState<OAuthCallbackState>("loading");
  const [returnHref, setReturnHref] = useState<string | undefined>();
  const started = useRef(false);

  useEffect(() => {
    if (authState.status === "loading") return;
    if (authState.status === "unauthenticated") {
      setCallbackState("error");
      setMessage("Sessão do Vorix expirada. Entre novamente e conecte o Google Calendar outra vez.");
      return;
    }
    if (started.current) return;
    started.current = true;
    const returnPath = window.sessionStorage.getItem(GOOGLE_CALENDAR_RETURN_KEY);
    setReturnHref(returnPath ?? undefined);
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
      setMessage("Retorno inválido do Google: falta o código de autorização.");
      return;
    }
    completeGoogleCalendar(state, code)
      .then((result) => {
        setCallbackState("success");
        setMessage(`Google Calendar ${result.googleEmail ?? ""} conectado. Redirecionando...`);
        window.sessionStorage.removeItem(GOOGLE_CALENDAR_RETURN_KEY);
        if (returnPath) router.replace(returnPath);
      })
      .catch((cause: unknown) => {
        setCallbackState("error");
        setMessage(cause instanceof Error ? cause.message : "Não foi possível concluir a conexão com o Google Calendar.");
      });
  }, [authState.status, params, router]);

  return <OAuthCallbackPanel state={callbackState} message={message} returnHref={returnHref} />;
}

export default function GoogleCalendarCallbackPage() {
  return (
    <Suspense fallback={<OAuthCallbackPanel state="loading" message="Conectando o Google Calendar..." />}>
      <GoogleCalendarCallbackContent />
    </Suspense>
  );
}
