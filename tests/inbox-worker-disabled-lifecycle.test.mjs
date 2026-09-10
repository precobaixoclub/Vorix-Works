import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, statSync, unlinkSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Fase 10 (Pre-Pilot Hardening) — achado real em produção: com `CONVERSATIONS_MODULE_ENABLED=false`
 * (o padrão), `vorix-worker` entrava num loop de restart infinito (`main()` retornava, o processo
 * saía com código 0, `restart: unless-stopped` religava, que saía de novo...). Só um teste que
 * sobe o PROCESSO DE VERDADE (não a função `main()` importada — ela nunca retorna enquanto o
 * processo fica ocioso de propósito, então importar e `await`-ar travaria o test runner) prova que
 * isto ficou corrigido: o processo continua vivo, o heartbeat continua fresco, `GET /status`
 * reflete o estado desabilitado, e SIGTERM ainda encerra limpo (nunca um processo "preso").
 */

function waitFor(conditionFn, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let result;
      try {
        result = conditionFn();
      } catch {
        result = false;
      }
      if (result) return resolve(undefined);
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor: timeout"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("httpGetJson: timeout")));
    req.on("error", reject);
  });
}

test("worker com CONVERSATIONS_MODULE_ENABLED=false: permanece vivo (sem restart loop), heartbeat fresco, GET /status reflete disabled, encerra limpo com SIGTERM", async (t) => {
  const heartbeatFile = join(tmpdir(), `inbox-worker-heartbeat-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const metricsPort = 19464 + Math.floor(Math.random() * 500); // faixa alta, fora do default (9464), evita colisão com um worker real rodando na mesma máquina

  const child = spawn(process.execPath, ["dist/interfaces/worker/inbox-worker.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_MODULE_ENABLED: "false",
      INBOX_WORKER_HEARTBEAT_FILE: heartbeatFile,
      INBOX_WORKER_HEARTBEAT_INTERVAL_MS: "300",
      INBOX_WORKER_METRICS_PORT: String(metricsPort),
      INBOX_WORKER_METRICS_ENABLED: "true",
      PERSISTENCE_DRIVER: "memory",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let exited = false;
  let exitCode;
  let exitSignal;
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.on("exit", (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  t.after(() => {
    if (!exited) child.kill("SIGKILL");
    if (existsSync(heartbeatFile)) {
      try {
        unlinkSync(heartbeatFile);
      } catch {
        // best-effort cleanup
      }
    }
  });

  try {
    // 1) Heartbeat aparece — prova que o worker entrou no ramo "desabilitado, mas vivo" (não morreu
    // antes de tocar o arquivo).
    await waitFor(() => existsSync(heartbeatFile), { timeoutMs: 5000 });

    // 2) Ainda vivo depois de um tempo maior que o antigo "morre e o Docker religa" levaria —
    // prova direta de que não há mais restart loop (se estivesse, o processo já teria saído).
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(exited, false, "o processo NUNCA deveria sair sozinho com o módulo desligado — encontrar isso é o próprio restart loop antigo voltando");

    // 3) Heartbeat continua sendo tocado (não é só um arquivo estático deixado uma vez).
    const ageBefore = Date.now() - statSync(heartbeatFile).mtimeMs;
    assert.ok(ageBefore < 2000, `heartbeat deveria estar fresco (idade ${ageBefore}ms)`);

    // 4) GET /status — o sinal semântico que distingue "desligado de propósito" de "quebrado".
    const status = await httpGetJson(`http://127.0.0.1:${metricsPort}/status`);
    assert.deepEqual(status, { moduleEnabled: false, consumersRunning: false, status: "disabled" });

    // 5) SIGTERM encerra limpo (nunca um processo "preso" que precisaria de SIGKILL em produção).
    // No Windows, o Node não emula SIGTERM como um sinal capturável de verdade (child.kill mata o
    // processo direto, sem rodar o handler de `process.on("SIGTERM", ...)`) — mesmo mecanismo já
    // usado pelo caminho "habilitado" deste worker, não algo introduzido aqui. Em produção (Linux,
    // Docker) o handler roda de verdade; localmente só confirmamos que o processo efetivamente
    // encerra (nunca fica "preso") e, quando o handler RODOU (POSIX), que o log de shutdown limpo
    // apareceu e o código foi 0.
    child.kill("SIGTERM");
    await waitFor(() => exited, { timeoutMs: 5000 });
    if (process.platform !== "win32") {
      assert.equal(exitCode, 0, "SIGTERM no estado ocioso precisa encerrar com código 0, igual ao shutdown normal");
      assert.ok(stdout.includes("encerrando (estado ocioso)"), "o handler de SIGTERM precisa ter rodado (log de shutdown limpo)");
    } else {
      assert.equal(exitSignal, "SIGTERM", "no Windows o Node mata o processo direto no sinal (limitação de plataforma, não do worker) — só confirmamos que encerrou de fato");
    }
  } finally {
    if (!exited) child.kill("SIGKILL");
  }
});
