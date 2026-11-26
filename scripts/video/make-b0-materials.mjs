#!/usr/bin/env node
// Materiais da prova B0 (sem dados de clientes):
// - fotos reais da camiseta CMKV (marca própria) e logo CMKV — copiados de tmp/cmkv-visual-review-20261123
// - capturas reais do site Rumo ao Altar (assets/media/company-screenshots)
// - "gravação bruta" de 70 s: screencast das capturas + narração pt-BR (voz Maria do Windows) com
//   pausas e hesitações, para o editor cortar
// - narração curta para o demo 16:9
// - trilha instrumental ORIGINAL sintetizada (placeholder: a Vorix ainda não tem biblioteca licenciada)
// Uso: node scripts/video/make-b0-materials.mjs [pasta]   (Windows: usa System.Speech para a voz)
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpeg = resolve(require.resolve("ffmpeg-static/package.json"), "..", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const out = resolve(process.argv[2] ?? "artifacts/video-b0/materials");

function run(cmd, args, opts = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...opts });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", () => {});
    child.on("close", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} saiu com ${code}: ${err.slice(-600)}`))));
  });
}
const ff = (args) => run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args]);

/** Voz pt-BR do Windows a partir de SSML (texto fixo deste script, nunca de usuário). */
async function speak(ssml, wav) {
  const ssmlFile = `${wav}.ssml`;
  await writeFile(ssmlFile, ssml, "utf8");
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft Maria Desktop'); $s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}'); $s.SpeakSsml([IO.File]::ReadAllText('${ssmlFile.replace(/'/g, "''")}')); $s.Dispose()`;
  await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]);
}
const ssml = (body, rate = "medium") => `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR"><prosody rate="${rate}">${body}</prosody></speak>`;

const RAW_SCRIPT = ssml(`
Oi, tudo bem? <break time="900ms"/> Então, é... deixa eu só ajustar aqui. <break time="1600ms"/>
Hoje eu quero te mostrar uma coisa que mudou o casamento de muita gente. <break time="700ms"/>
Sabe aquela lista de presentes cheia de taxa? <break time="500ms"/> Pois é. <break time="1200ms"/>
No Rumo ao Altar, os noivos recebem cem por cento do presente, direto no Pix, sem nenhuma taxa. <break time="1500ms"/>
É... onde eu estava? <break time="1800ms"/> Ah, sim. <break time="600ms"/>
Os convidados confirmam presença pelo próprio site, e vocês acompanham tudo em tempo real. <break time="1100ms"/>
Tem também o álbum colaborativo: <break time="300ms"/> cada convidado manda as fotos da festa por um QR Code. <break time="2000ms"/>
Hum... deixa eu ver se esqueci alguma coisa. <break time="1500ms"/>
E o melhor: <break time="300ms"/> você cria o site oficial do seu casamento em menos de um minuto. <break time="900ms"/>
Acessa rumoaoaltar ponto com ponto br e cria o seu agora. <break time="1500ms"/> É isso, valeu!`);

const DEMO_NARRATION = ssml(`O site oficial do seu casamento, pronto em um minuto. <break time="400ms"/> Presentes direto no Pix, sem taxas. <break time="300ms"/> Confirmação de presença e álbum colaborativo. <break time="400ms"/> Crie o seu no Rumo ao Altar.`, "+8%");

// Trilha original: Lá menor (Am–F–C–G), 100 BPM: pad com leve detune, arpejo, bumbo e chimbal.
function musicExpression(channelDetune) {
  const bar = "mod(floor(t/2.4)\\,4)";
  const pick = (a, b, c, d) => `if(eq(${bar}\\,0)\\,${a}\\,if(eq(${bar}\\,1)\\,${b}\\,if(eq(${bar}\\,2)\\,${c}\\,${d})))`;
  const f1 = pick(220, 174.61, 261.63, 196);
  const f2 = pick(261.63, 220, 329.63, 246.94);
  const f3 = pick(329.63, 261.63, 392, 293.66);
  const pad = `0.05*(sin(2*PI*${f1}*t)+sin(2*PI*${f1}*${channelDetune}*t)+sin(2*PI*${f2}*t)+sin(2*PI*${f3}*t))*(0.75+0.25*sin(2*PI*0.21*t))`;
  const note = `mod(floor(t/0.3)\\,4)`;
  const arpF = `if(eq(${note}\\,0)\\,${f1}*2\\,if(eq(${note}\\,1)\\,${f2}*2\\,if(eq(${note}\\,2)\\,${f3}*2\\,${f2}*2)))`;
  const arp = `0.09*exp(-mod(t\\,0.3)*9)*sin(2*PI*${arpF}*t)`;
  const kick = `0.42*exp(-mod(t\\,0.6)*16)*sin(2*PI*(48+90*exp(-mod(t\\,0.6)*28))*mod(t\\,0.6))`;
  const hat = `0.035*exp(-mod(t+0.3\\,0.6)*55)*(2*random(0)-1)`;
  const intro = `min(1\\,t/4)`;
  return `(${pad}+${arp}+${kick}*${intro}+${hat}*${intro})`;
}

async function main() {
  await mkdir(out, { recursive: true });
  const cmkv = "tmp/cmkv-visual-review-20261123";
  for (const name of ["Bege.webp", "Preto.webp", "Verde-Militar.webp", "marca-cmkv.png"]) {
    if (!existsSync(join(cmkv, name))) throw new Error(`Material CMKV ausente: ${join(cmkv, name)}`);
  }
  // Fotos convertidas para JPEG de alta qualidade (o motor aceita webp, mas o JPEG é o caso comum).
  await ff(["-i", join(cmkv, "Bege.webp"), "-q:v", "2", join(out, "cmkv-bege.jpg")]);
  await ff(["-i", join(cmkv, "Preto.webp"), "-q:v", "2", join(out, "cmkv-preto.jpg")]);
  await ff(["-i", join(cmkv, "Verde-Militar.webp"), "-q:v", "2", join(out, "cmkv-verde.jpg")]);
  await copyFile(join(cmkv, "marca-cmkv.png"), join(out, "cmkv-logo.png"));
  const screens = "assets/media/company-screenshots";
  for (const name of ["home.png", "demo.png", "site-demo-presentes.png", "site-demo-fotos.png", "precos.png"]) await copyFile(join(screens, name), join(out, `raa-${name}`));

  console.log("[b0] trilha original sintetizada (40 s)");
  await ff(["-f", "lavfi", "-i", `aevalsrc=${musicExpression(1.003)}|${musicExpression(0.997)}:s=48000:d=40`, "-af", "aecho=0.8:0.6:90|170:0.22|0.14,highpass=f=35,lowpass=f=11000,loudnorm=I=-16:TP=-2", "-ar", "48000", join(out, "music-original.wav")]);

  console.log("[b0] narração pt-BR (voz Maria do Windows)");
  await speak(RAW_SCRIPT, join(out, "raw-voice.wav"));
  await speak(DEMO_NARRATION, join(out, "demo-narration.wav"));

  console.log("[b0] gravação bruta: screencast 1920x1080 com a narração");
  const shots = ["home.png", "demo.png", "site-demo-presentes.png", "site-demo-fotos.png", "precos.png"].map((name) => join(out, `raa-${name}`));
  const each = 17;
  const inputs = shots.flatMap((file) => ["-loop", "1", "-framerate", "30", "-t", String(each), "-i", file]);
  const scroll = shots.map((_, i) => `[${i}:v]scale=1920:-2,crop=1920:1080:0:'min(ih-1080\\,(ih-1080)*t/${each})',setsar=1,fps=30[s${i}]`).join(";");
  await ff([...inputs, "-i", join(out, "raw-voice.wav"), "-filter_complex", `${scroll};${shots.map((_, i) => `[s${i}]`).join("")}concat=n=${shots.length}:v=1:a=0[v]`, "-map", "[v]", "-map", `${shots.length}:a`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", join(out, "raw-recording.mp4")]);
  console.log(`[b0] materiais em ${out}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
