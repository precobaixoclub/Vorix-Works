// PROVA COM O DIRETOR REAL (lado do host, root): para cada caso emitido por `remotion-proof.mjs --emit-prompts`,
// chama o Codex (usuário vorix-codex, `codex exec`, mesmo modelo e sandbox do piloto) com o prompt do diretor,
// o schema estrito e as miniaturas, e grava `<caso>-codex.json` (a saída crua, convertida depois por toDraft).
// Sem rede além do próprio Codex, sem banco, sem publicar. Não usa API paga: a conta do Codex é a do piloto.
//
// Uso: node codex-director-proof.mjs <pasta-emitida> <casos: A-cmkv,B-vorix,C-fala>
import { spawn } from "node:child_process";
import { chown, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const [dir, list = "A-cmkv,B-vorix,C-fala"] = process.argv.slice(2);
if (!dir) throw new Error("Uso: node codex-director-proof.mjs <pasta> [casos]");
const agentHome = "/var/lib/vorix-codex";
const agent = ["-u", "vorix-codex", "--", "env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", `HOME=${agentHome}`, `CODEX_HOME=${agentHome}/.codex`, "/opt/vorix-editorial/tools/node_modules/.bin/codex"];

function run(program, args, stdin, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("tempo limite do Codex")); }, timeout);
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    child.stdin.on("error", () => undefined);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString("utf8").trim());
      else reject(new Error(Buffer.concat(err).toString("utf8").trim().split("\n").slice(-6).join("\n") || `código ${code}`));
    });
    child.stdin.end(stdin);
  });
}

const user = (await readFile("/etc/passwd", "utf8")).split("\n").find((line) => line.startsWith("vorix-codex:"))?.split(":");
const summary = {};
for (const name of list.split(",")) {
  const jobDir = await mkdtemp(join(agentHome, "jobs", "prova-av-"));
  try {
    await chown(jobDir, Number(user[2]), Number(user[3]));
    const prompt = await readFile(join(dir, `${name}-prompt.txt`), "utf8");
    const images = JSON.parse(await readFile(join(dir, `${name}-imagens.json`), "utf8"));
    const staged = [];
    for (const image of images) {
      // Caminhos emitidos no Windows chegam com "\": o nome do arquivo é o mesmo nos dois sistemas.
      const name = basename(image.replaceAll("\\", "/"));
      const target = join(jobDir, name);
      await copyFile(join(dir, name), target);
      staged.push(target);
    }
    const schemaFile = join(jobDir, "schema.json");
    await copyFile(join(dir, "schema.json"), schemaFile);
    const started = Date.now();
    const events = await run("runuser", [...agent, "--ask-for-approval", "never", "exec", "--model", "gpt-6.2-sol", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check",
      "--cd", jobDir, "--json", "--output-schema", schemaFile, ...staged.flatMap((path) => ["--image", path]), "-"], `${prompt}\nNão gere imagens e não execute comandos.`, Number(process.env.CODEX_TIMEOUT_MS ?? 400000));
    const last = events.split("\n").flatMap((line) => { try { const e = JSON.parse(line); return e.type === "item.completed" && e.item?.type === "agent_message" ? [e.item.text] : []; } catch { return []; } }).at(-1);
    if (!last) throw new Error("Codex sem resposta");
    const output = JSON.parse(last);
    await writeFile(join(dir, `${name}-codex.json`), JSON.stringify(output, null, 2));
    summary[name] = { ms: Date.now() - started, scenes: output.scenes?.length, story: output.story, emotions: output.scenes?.map((s) => s.emotion), templates: output.scenes?.map((s) => s.design?.template ?? "ffmpeg"), sfx: output.sfx };
    console.error(`[codex] ${name}: ${((Date.now() - started) / 1000).toFixed(0)} s, ${output.scenes?.length} cenas`);
  } catch (error) {
    summary[name] = { error: String(error.message ?? error).slice(0, 400) };
    console.error(`[codex] ${name} FALHOU: ${error.message}`);
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}
await writeFile(join(dir, "codex-resumo.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
