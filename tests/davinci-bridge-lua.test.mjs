// Testa a ponte Lua REAL (src/infrastructure/davinci-resolve/lua/VorixBridge.lua) no LuaJIT, com um
// Resolve simulado. Prova que as operações geradas pelo compilador TypeScript passam pela validação
// Lua e viram as chamadas de API esperadas — e que pedidos maliciosos são recusados.
// Sem LuaJIT instalado o teste é pulado (não substitui a prova ao vivo no DaVinci).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { compileEditPlan } from "../dist/infrastructure/davinci-resolve/compile-edit-plan.js";
import { imagesAdPlan, footagePlan } from "./helpers/video-edit-fixtures.mjs";

const LUAJIT = [join(homedir(), "AppData", "Local", "Programs", "LuaJIT", "bin", "luajit.exe"), "/usr/bin/luajit", "/usr/local/bin/luajit"].find((path) => existsSync(path));
const BRIDGE = new URL("../src/infrastructure/davinci-resolve/lua/VorixBridge.lua", import.meta.url);
const MOCK = new URL("./fixtures/davinci/resolve-mock.lua", import.meta.url);
const RUNNER = new URL("./fixtures/davinci/run-bridge.lua", import.meta.url);

function runBridge(requests) {
  const dir = mkdtempSync(join(tmpdir(), "vorix-lua-"));
  const file = join(dir, "requests.jsonl");
  writeFileSync(file, requests.map((request) => (typeof request === "string" ? request : JSON.stringify(request))).join("\n"));
  const result = spawnSync(LUAJIT, [RUNNER.pathname.replace(/^\/(\w:)/, "$1"), MOCK.pathname.replace(/^\/(\w:)/, "$1"), BRIDGE.pathname.replace(/^\/(\w:)/, "$1"), file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { responses: lines.filter((line) => line.id !== undefined), calls: lines.filter((line) => line.call).map((line) => line.call) };
}

const request = (op, args, id) => ({ v: 1, id: id ?? `${op}-${Math.random().toString(36).slice(2, 8)}`, op, args });

test("ponte não contém primitivas de execução de código nem shell", () => {
  const source = readFileSync(BRIDGE, "utf8").replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--[^\n]*/g, "");
  for (const forbidden of ["loadstring", "load(", "dofile", "require", "os.execute", "io.popen", "loadfile", "setfenv"]) {
    assert.ok(!source.includes(forbidden), `ponte usa ${forbidden}`);
  }
});

test("operações compiladas do anúncio passam pela ponte Lua e chegam à API", { skip: !LUAJIT && "LuaJIT não instalado" }, () => {
  const job = compileEditPlan(imagesAdPlan(), { jobId: "job-ad-lua" });
  const { responses, calls } = runBridge(job.operations.map((operation, index) => request(operation.op, operation.args, `r${index}`)));
  const failed = responses.filter((response) => !response.ok);
  assert.deepEqual(failed, [], JSON.stringify(failed));
  assert.ok(calls.includes("project Vorix job-ad-lua"));
  assert.ok(calls.includes("setting timelineResolutionWidth 1080"));
  assert.ok(calls.some((call) => call.startsWith("import ") && call.includes("jobs") && call.endsWith("photo-ax.jpg")));
  // recordFrame somado ao início da timeline (108000)
  assert.ok(calls.some((call) => call.startsWith("append ") && call.endsWith(" 2 108105 1")), calls.filter((c) => c.startsWith("append")).join("\n"));
  assert.ok(calls.includes("format mp4 H264"));
  assert.ok(calls.some((call) => call.startsWith("render-settings ") && call.includes("output vorix-job-ad-lua 1080 1920")));
  assert.ok(calls.includes("start-render"));
  assert.ok(calls.some((call) => call.startsWith("addtool TextPlus")));
  assert.ok(calls.some((call) => call.startsWith("set TextPlus") && call.includes("StyledText Estampas que")));
  assert.ok(calls.some((call) => call.startsWith("key bezier 15 1")), "keyframe de dissolve aplicado");
});

test("operações compiladas do Reels (fala, legendas, trilha) passam pela ponte", { skip: !LUAJIT && "LuaJIT não instalado" }, () => {
  const job = compileEditPlan(footagePlan(), { jobId: "job-reels-lua" });
  const { responses, calls } = runBridge(job.operations.map((operation, index) => request(operation.op, operation.args, `r${index}`)));
  assert.deepEqual(responses.filter((response) => !response.ok), []);
  assert.equal(calls.filter((call) => call.startsWith("append ") && call.endsWith(" 2")).length, 4, "3 trechos de fala + trilha");
  assert.ok(calls.some((call) => call.includes("StyledText Você perde")), "acentos preservados");
});

test("ponte recusa operações e argumentos maliciosos", { skip: !LUAJIT && "LuaJIT não instalado" }, () => {
  const setup = [request("create_project", { name: "Vorix sec", width: 1080, height: 1920, fps: 30 }, "s1")];
  const attacks = [
    request("run", { code: "os.execute('calc')" }, "a1"),
    request("__index", {}, "a2"),
    request("import_media", { jobId: "job-1x", files: ["..\\..\\Windows\\win.ini"] }, "a3"),
    request("import_media", { jobId: "..\\x", files: ["ok.mp4"] }, "a4"),
    request("import_media", { jobId: "job-1x", files: ["ok.mp4"], root: "C:\\" }, "a5"),
    request("set_clip_properties", { ref: "x", props: { Script: 1 } }, "a6"),
    request("create_project", { name: "x; os.exit()", width: 1080, height: 1920, fps: 30 }, "a7"),
    request("create_project", { name: "big", width: 7680, height: 4320, fps: 30 }, "a8"),
    { v: 2, id: "a9", op: "ping", args: {} },
    "{not json",
    request("set_render", { jobId: "job-1x", fileName: "..\\..\\evil", width: 1080, height: 1920, fps: 30 }, "a10"),
  ];
  const { responses, calls } = runBridge([...setup, ...attacks]);
  assert.equal(responses[0].ok, true);
  const rest = responses.slice(1);
  assert.equal(rest.length, attacks.length);
  for (const response of rest) assert.equal(response.ok, false, JSON.stringify(response));
  assert.ok(!calls.some((call) => call.startsWith("import")), "nada foi importado");
});

test("JSON da ponte: escapes, unicode e aninhamento excessivo", { skip: !LUAJIT && "LuaJIT não instalado" }, () => {
  const deep = `{"v":1,"id":"d1","op":"ping","args":${"[".repeat(30)}${"]".repeat(30)}}`;
  const { responses } = runBridge([
    request("ping", {}, "p1"),
    `{"v":1,"id":"p2","op":"create_project","args":{"name":"Vorix \\u00e7a","width":1080,"height":1080,"fps":30}}`,
    deep,
  ]);
  assert.equal(responses[0].ok, true);
  assert.equal(responses[0].result.version, "21.1.2.10");
  assert.equal(responses[1].ok, false, "nome com ç recusado pelo padrão ASCII de nome de projeto");
  assert.equal(responses[2].ok, false);
});
