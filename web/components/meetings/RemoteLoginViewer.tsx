"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { getApiBaseUrl } from "@/lib/api-error";
import { getAccessToken } from "@/lib/auth-token";
import { keyDownMessage, keyUpMessage, parseFrame, pasteMessage, streamUrl } from "@/features/meetings/remote-login";
import type { ProvisioningSessionStatus } from "@/features/meetings/types";

type ViewerStatus = ProvisioningSessionStatus | "connecting" | "waiting_worker" | "detected";

const STATUS_COPY: Partial<Record<ViewerStatus, string>> = {
  connecting: "Abrindo um navegador seguro e temporário…",
  waiting_worker: "Preparando o navegador de conexão…",
  pending: "Preparando o navegador de conexão…",
  starting: "Abrindo a página de login do Google…",
  live: "Entre na conta Google de gravação na tela abaixo.",
  detected: "Login detectado — testando a conta no Google Meet…",
};


/**
 * Tela do navegador temporário em que o CLIENTE faz login direto no Google (senha, MFA, desafios).
 * Os frames chegam por WebSocket; cliques e teclas voltam para o navegador remoto e não são
 * guardados nem registrados em lugar nenhum — nem aqui, nem na API, nem no recorder.
 */
export function RemoteLoginViewer({ viewerToken, streamPath, onFinished }: { viewerToken: string; streamPath: string; onFinished: (result: { status: ProvisioningSessionStatus; message?: string; code?: string }) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const frameSize = useRef({ width: 1024, height: 720 });
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const [status, setStatus] = useState<ViewerStatus>("connecting");
  const [message, setMessage] = useState<string | undefined>();
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const socket = new WebSocket(streamUrl(getApiBaseUrl(), streamPath));
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    let done = false;
    // O token vai na 1ª mensagem (nunca na URL, para não aparecer em log de acesso).
    socket.onopen = () => socket.send(JSON.stringify({ t: "auth", token: viewerToken, accessToken: getAccessToken() }));
    socket.onmessage = async (event) => {
      if (typeof event.data === "string") {
        const payload = JSON.parse(event.data) as { t: string; s?: ViewerStatus; m?: string; code?: string };
        if (payload.t !== "status" || !payload.s) return;
        setStatus(payload.s);
        setMessage(payload.m);
        if (["completed", "failed", "expired", "cancelled"].includes(payload.s) && !done) {
          done = true;
          finishedRef.current({ status: payload.s as ProvisioningSessionStatus, ...(payload.m ? { message: payload.m } : {}), ...(payload.code ? { code: payload.code } : {}) });
        }
        return;
      }
      const frame = parseFrame(event.data as ArrayBuffer);
      if (!frame) return;
      const { width, height } = frame;
      frameSize.current = { width, height };
      const bitmap = await createImageBitmap(new Blob([frame.jpeg], { type: "image/jpeg" })).catch(() => undefined);
      const canvas = canvasRef.current;
      if (!bitmap || !canvas) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      setHasFrame(true);
    };
    socket.onclose = () => {
      if (!done) {
        done = true;
        finishedRef.current({ status: "failed", message: "A conexão com o navegador de login foi encerrada." });
      }
    };
    return () => {
      done = true;
      socket.close();
    };
  }, [streamPath, viewerToken]);

  const send = (payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };
  const point = (event: React.MouseEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * frameSize.current.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * frameSize.current.height),
    };
  };
  const button = (value: number) => (value === 2 ? "right" : value === 1 ? "middle" : "left");

  const interactive = status === "live";
  const failed = ["failed", "expired", "cancelled"].includes(status);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary dark:text-primary-glow" aria-hidden="true" />
        <p>
          Você digita a senha e a verificação em duas etapas <strong className="font-medium text-foreground">direto no Google</strong>, num navegador temporário e isolado.
          O Vorix não vê, não registra e não guarda sua senha, códigos de verificação ou códigos de recuperação — só a sessão resultante, criptografada. O navegador é destruído ao final.
        </p>
      </div>
      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/30">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="Navegador de login do Google"
          className={`block h-auto w-full outline-none focus:ring-2 focus:ring-primary/30 ${hasFrame ? "" : "invisible"} ${interactive ? "cursor-default" : "pointer-events-none"}`}
          style={{ aspectRatio: `${frameSize.current.width} / ${frameSize.current.height}` }}
          onContextMenu={(event) => event.preventDefault()}
          onMouseDown={(event) => { event.currentTarget.focus(); send({ t: "mouse", a: "down", ...point(event), b: button(event.button) }); }}
          onMouseUp={(event) => send({ t: "mouse", a: "up", ...point(event), b: button(event.button) })}
          onMouseMove={(event) => { if (event.buttons) send({ t: "mouse", a: "move", ...point(event) }); }}
          onWheel={(event) => send({ t: "wheel", ...point(event), dy: Math.round(event.deltaY), dx: Math.round(event.deltaX) })}
          onKeyDown={(event) => {
            const message = keyDownMessage(event);
            if (!message) return; // atalhos com Ctrl/⌘ ficam no navegador local; colar é tratado em onPaste
            event.preventDefault();
            send(message);
          }}
          onKeyUp={(event) => { const message = keyUpMessage(event); if (message) send(message); }}
          onPaste={(event) => {
            event.preventDefault();
            const message = pasteMessage(event.clipboardData.getData("text"));
            if (message) send(message);
          }}
        />
        {!hasFrame || status === "detected" ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {STATUS_COPY[status] ?? "Conectando…"}
          </div>
        ) : null}
      </div>
      <p className="flex items-center gap-2 text-sm" role="status">
        {status === "completed" ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /> : failed ? <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" /> : null}
        <span className={failed ? "text-destructive" : "text-muted-foreground"}>
          {status === "completed" ? "Conta conectada e testada no Google Meet." : message ?? STATUS_COPY[status] ?? ""}
        </span>
      </p>
      {interactive ? <p className="text-xs text-muted-foreground">Clique na tela acima antes de digitar. Se o Google pedir uma verificação, conclua normalmente — ela aparece aqui.</p> : null}
    </div>
  );
}
