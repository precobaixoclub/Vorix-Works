import test from "node:test";
import assert from "node:assert/strict";
import { validateVideoEditPlan, isSafeMediaFileName } from "../dist/domain/video-editing/video-edit-plan.js";
import { compileEditPlan, PlanCompilationError, wrapText, TEXT_CARRIER_FILE, PREPARED_MUSIC_FILE } from "../dist/infrastructure/davinci-resolve/compile-edit-plan.js";
import { assertValidOperation, BridgeArgumentError } from "../dist/infrastructure/davinci-resolve/bridge-protocol.js";
import { imagesAdPlan, footagePlan } from "./helpers/video-edit-fixtures.mjs";

const issuesOf = (plan) => validateVideoEditPlan(plan).issues.map((issue) => `${issue.path}: ${issue.message}`);

test("planos de exemplo são válidos", () => {
  assert.deepEqual(issuesOf(imagesAdPlan()), []);
  assert.deepEqual(issuesOf(footagePlan()), []);
});

test("rejeita caminhos e nomes de arquivo inseguros", () => {
  for (const name of ["../x.mp4", "..\\x.mp4", "C:\\x.mp4", "/etc/passwd", "a/b.mp4", "x.exe", "x.lua", ".hidden.mp4", "a..b.mp4"]) {
    assert.equal(isSafeMediaFileName(name), false, name);
  }
  const plan = imagesAdPlan();
  plan.assets[0].fileName = "..\\..\\Windows\\win.ini";
  assert.ok(issuesOf(plan).some((issue) => issue.includes("nome de arquivo inseguro")));
});

test("rejeita buracos e sobreposição fora de transição na timeline", () => {
  const plan = imagesAdPlan();
  plan.clips[2].recordStartSeconds = 7.4;
  assert.ok(issuesOf(plan).some((issue) => issue.startsWith("clips[2].recordStartSeconds")));
});

test("rejeita trecho além do fim da mídia de origem e duração inconsistente", () => {
  const plan = footagePlan();
  plan.clips[2].sourceInSeconds = 58;
  assert.ok(issuesOf(plan).some((issue) => issue.includes("ultrapassa o fim")));
  const other = footagePlan({ durationSeconds: 20 });
  assert.ok(issuesOf(other).some((issue) => issue.includes("soma da timeline")));
});

test("protege produto: sem texto central nem movimento forte", () => {
  const plan = imagesAdPlan();
  plan.clips[0].overlays[0].position = "center";
  plan.clips[1].motion.intensity = 0.9;
  const issues = issuesOf(plan);
  assert.ok(issues.some((issue) => issue.includes("cobre o produto")));
  assert.ok(issues.some((issue) => issue.includes("fidelidade protegida")));
});

test("rejeita texto com caracteres de controle e resolução fora do formato", () => {
  const plan = imagesAdPlan({ width: 1920, height: 1080 });
  plan.clips[0].overlays[0].text = "oi\u0007";
  const issues = issuesOf(plan);
  assert.ok(issues.some((issue) => issue.includes("caracteres de controle")));
  assert.ok(issues.some((issue) => issue.includes("resolução deve ser 1080x1920")));
});

test("compilador recusa plano inválido sem gerar operações", () => {
  const plan = imagesAdPlan();
  plan.clips = [];
  assert.throws(() => compileEditPlan(plan, { jobId: "job-test-1" }), PlanCompilationError);
});

test("compila anúncio com imagens: trilhas, quadros, logo, texto e render", () => {
  const job = compileEditPlan(imagesAdPlan(), { jobId: "job-ad-1" });
  const ops = job.operations.map((operation) => operation.op);
  assert.equal(ops[0], "create_project");
  assert.equal(ops.at(-1), "start_render");
  assert.equal(job.durationFrames, 450);
  for (const operation of job.operations) assertValidOperation(operation);

  const appends = job.operations.filter((operation) => operation.op === "append_clip");
  const content = appends.filter((operation) => operation.args.ref.startsWith("clip-"));
  assert.deepEqual(content.map((operation) => operation.args.trackIndex), [1, 2, 1, 2]);
  assert.deepEqual(content.map((operation) => operation.args.recordFrame), [0, 105, 210, 315]);
  // endFrame inclusivo: 120 quadros = 0..119
  assert.equal(content[0].args.endFrame, 119);

  const logo = appends.find((operation) => operation.args.ref === "logo");
  assert.equal(logo.args.trackIndex, 3);
  const text = appends.find((operation) => operation.args.ref === "text");
  assert.equal(text.args.trackIndex, 4);
  assert.equal(text.args.fileName, TEXT_CARRIER_FILE);
  const music = appends.find((operation) => operation.args.ref === "music");
  assert.equal(music.args.mediaType, 2);
  assert.equal(music.args.fileName, PREPARED_MUSIC_FILE);
  assert.ok(job.music && job.music.gainDb === -14);

  const imported = job.operations.find((operation) => operation.op === "import_media").args.files;
  assert.ok(imported.includes(TEXT_CARRIER_FILE) && imported.includes(PREPARED_MUSIC_FILE));
  assert.ok(!imported.includes("song-x.wav"), "a trilha bruta não entra no DaVinci, só a preparada");
});

test("transições: dissolve anima só o clipe de cima, push move os dois, dip escurece", () => {
  const job = compileEditPlan(imagesAdPlan(), { jobId: "job-ad-2" });
  const style = Object.fromEntries(job.operations.filter((operation) => operation.op === "style_clip").map((operation) => [operation.args.ref, operation.args]));
  // c1 abre do preto
  assert.deepEqual(style["clip-1"].dip[0], { f: 0, v: 1 });
  // c2 (V2) entra por dissolve sobre c1 (V1): alpha 0→1 em 15 quadros
  assert.deepEqual(style["clip-2"].alpha, [{ f: 0, v: 0 }, { f: 15, v: 1 }]);
  // c3 (V1) entra por push sob c2 (V2): c3 desliza da direita e c2 sai pela esquerda
  assert.equal(style["clip-3"].centerX[0].v, 1.5);
  assert.equal(style["clip-3"].centerX.at(-1).v, 0.5);
  assert.ok(style["clip-2"].centerX.at(-1).v < -0.4);
  // c4 (V2) entra por zoom sobre c3 (V1): c4 aparece por dissolve; c3 aumenta
  assert.equal(style["clip-4"].alpha[0].v, 0);
  assert.ok(style["clip-3"].size.at(-1).v > 1.3);
});

test("enquadramento fill calcula zoom pelo encaixe e desloca para o foco", () => {
  const job = compileEditPlan(footagePlan(), { jobId: "job-reels-1" });
  const props = job.operations.find((operation) => operation.op === "set_clip_properties" && operation.args.ref === "clip-1").args.props;
  // 1920x1080 em 1080x1920: fit=0.5625, fill=1.7778 → zoom 3.1605
  assert.ok(Math.abs(props.ZoomX - 3.1605) < 0.001);
  assert.ok(props.Pan > 0, "foco à esquerda do centro desloca a imagem para a direita");
});

test("legenda que colide com título na mesma posição sobe para o topo", () => {
  const job = compileEditPlan(footagePlan(), { jobId: "job-reels-2" });
  const layers = job.operations.find((operation) => operation.op === "build_text_layer").args.layers;
  const cta = layers.find((layer) => layer.text === "Teste grátis");
  const caption = layers.find((layer) => layer.text.startsWith("A Vorix"));
  assert.ok(caption.y > cta.y + 0.3, "legenda movida para longe do CTA");
  const first = layers.find((layer) => layer.text.startsWith("Você perde"));
  assert.equal(first.y, 0.24, "área segura inferior do 9:16");
});

test("fala mantém áudio original em A1/A2 e a trilha abaixa sob a fala", () => {
  const job = compileEditPlan(footagePlan(), { jobId: "job-reels-3" });
  const audio = job.operations.filter((operation) => operation.op === "append_clip" && operation.args.mediaType === 2 && operation.args.ref.endsWith("-audio"));
  assert.equal(audio.length, 3);
  assert.deepEqual(audio.map((operation) => operation.args.startFrame), [360, 900, 1500]);
  assert.deepEqual(job.music.duckWindows, [{ startSeconds: 0, endSeconds: 12 }]);
});

test("quebra de texto em até 3 linhas reduzindo a fonte quando preciso", () => {
  const short = wrapText("Compre agora", 0.05, 1080, 1920);
  assert.equal(short.lines.length, 1);
  const long = wrapText("Uma frase bem comprida para caber num vídeo vertical com fonte muito grande e muitas palavras", 0.08, 1080, 1920);
  assert.ok(long.lines.length <= 3);
  assert.ok(long.size < 0.08);
  for (const line of long.lines) assert.ok(line.length * long.size * 1920 * 0.56 <= 1080 * 0.84 + 1);
});

test("protocolo recusa operação desconhecida, campos extras e valores fora do limite", () => {
  assert.throws(() => assertValidOperation({ op: "run_lua", args: { code: "os.execute('calc')" } }), BridgeArgumentError);
  assert.throws(() => assertValidOperation({ op: "import_media", args: { jobId: "job-1x", files: ["../../secret.mp4"] } }), BridgeArgumentError);
  assert.throws(() => assertValidOperation({ op: "import_media", args: { jobId: "job-1x", files: ["ok.mp4"], path: "C:\\" } }), BridgeArgumentError);
  assert.throws(() => assertValidOperation({ op: "set_clip_properties", args: { ref: "clip-1", props: { Script: 1 } } }), BridgeArgumentError);
  assert.throws(() => assertValidOperation({ op: "create_project", args: { name: "x", width: 7680, height: 4320, fps: 30 } }), BridgeArgumentError);
  assert.throws(() => assertValidOperation({ op: "set_render", args: { jobId: "../x", fileName: "a", width: 10, height: 10, fps: 30 } }), BridgeArgumentError);
});
