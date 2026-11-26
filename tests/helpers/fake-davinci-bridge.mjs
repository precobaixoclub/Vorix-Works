// SIMULADOR da ponte do DaVinci para testes de cliente/executor. NÃO é prova de integração: ele só
// imita o protocolo de arquivos. No `start_render` gera um MP4 com o FFmpeg empacotado para que o
// Quality Gate tenha um arquivo real para medir.
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpeg = join(require.resolve("ffmpeg-static/package.json"), "..", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

export function makeVideo(output, { width, height, fps, seconds, blackFirst = 0, withAudio = true }) {
  const args = ["-hide_banner", "-y", "-f", "lavfi", "-i", `testsrc2=s=${width}x${height}:r=${fps}:d=${seconds}`];
  if (withAudio) args.push("-f", "lavfi", "-i", `sine=frequency=330:sample_rate=48000:duration=${seconds}`);
  const vf = blackFirst > 0 ? ["-vf", `drawbox=t=fill:c=black:enable='lt(t,${blackFirst})'`] : [];
  args.push(...vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast");
  if (withAudio) args.push("-c:a", "aac", "-shortest");
  args.push(output);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-500)))));
  });
}

export class FakeDavinciBridge {
  constructor(root, behavior = {}) {
    this.root = root;
    this.behavior = { renderSteps: ["Rendering", "Complete"], heartbeat: true, failOp: null, hangOp: null, protocol: 1, produce: true, blackFirst: 0, ...behavior };
    this.received = [];
    this.lastId = null;
    this.running = false;
    this.renderJob = null;
    this.renderStep = 0;
    this.renderSettings = null;
  }

  async start() {
    await Promise.all(["inbox", "outbox", "jobs"].map((dir) => mkdir(join(this.root, dir), { recursive: true })));
    this.running = true;
    this.loop = this.run();
    await this.beat();
  }

  async stop() {
    this.running = false;
    await this.loop;
  }

  async beat() {
    if (!this.behavior.heartbeat) return;
    await writeFile(join(this.root, "status.json"), JSON.stringify({ state: "ready", beat: Date.now(), bridge: "fake", protocol: this.behavior.protocol, caps: { io: true } }));
  }

  async run() {
    let tick = 0;
    while (this.running) {
      tick += 1;
      if (tick % 5 === 0) await this.beat();
      let raw = null;
      try {
        raw = await readFile(join(this.root, "inbox", "request.json"), "utf8");
      } catch {}
      if (raw) {
        const request = JSON.parse(raw);
        if (request.id !== this.lastId) {
          this.lastId = request.id;
          this.received.push(request);
          if (request.op !== this.behavior.hangOp) {
            const response = await this.handle(request);
            const tmp = join(this.root, "outbox", "response.json.tmp");
            await writeFile(tmp, JSON.stringify({ v: 1, id: request.id, ...response }));
            await rename(tmp, join(this.root, "outbox", "response.json"));
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async handle({ op, args }) {
    if (op === this.behavior.failOp) return { ok: false, error: `falha simulada em ${op}` };
    switch (op) {
      case "ping":
        return { ok: true, result: { product: "DaVinci Resolve (simulado)", version: "0.0" } };
      case "set_render":
        this.renderSettings = args;
        this.renderJob = "fake-render-1";
        return { ok: true, result: { renderJobId: this.renderJob, codec: "H264" } };
      case "start_render": {
        this.renderStep = 0;
        if (this.behavior.produce && this.behavior.video) {
          const { jobId, fileName } = this.renderSettings;
          await makeVideo(join(this.root, "jobs", jobId, "output", `${fileName}.mp4`), { ...this.behavior.video, blackFirst: this.behavior.blackFirst });
        }
        return { ok: true, result: { renderJobId: this.renderJob } };
      }
      case "render_status": {
        const status = this.behavior.renderSteps[Math.min(this.renderStep, this.behavior.renderSteps.length - 1)];
        this.renderStep += 1;
        return { ok: true, result: { status, percent: status === "Complete" ? 100 : 40, rendering: status === "Rendering" } };
      }
      default:
        return { ok: true, result: {} };
    }
  }
}

export async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
}

export function makeTone(output, seconds = 20) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i", `sine=frequency=220:sample_rate=48000:duration=${seconds}`, "-ac", "2", output], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-500)))));
  });
}
