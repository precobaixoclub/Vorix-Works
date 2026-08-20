import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeveloperAssistedIcaroProvider } from "../dist/infrastructure/ai/developer-assisted-icaro-provider.js";
import { DeveloperAssistancePendingError } from "../dist/application/ai/developer-assistance.types.js";
import { LocalArtifactDelivery } from "../dist/infrastructure/artifacts/index.js";

// Migração "GPT como motor criativo único" (PR 3/9): `provenance` agora é obrigatório em
// `writeFile`. Estes testes simulam o arquivo de RESPOSTA que um humano/IDE escreveria por fora
// do ArtifactDeliveryPort — usar o port aqui é só um atalho de teste para colocar os bytes em
// disco, então qualquer proveniência válida serve; usamos `publishable: true` porque o cenário
// simulado é conteúdo real, escrito por um humano.
const FAKE_HUMAN_RESPONSE_PROVENANCE = { producer: "developer_assisted", publishable: true };

async function withArtifactsDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "zuno-icaro-assisted-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mariaRequest(overrides = {}) {
  return {
    taskType: "text_generation",
    prompt: "Escreva uma copy sobre a lista de presentes com taxa zero.",
    specialistId: "maria-copywriting",
    executionId: "execution-A",
    taskId: "step-0003",
    context: { clientId: "client-rumo", channel: "instagram" },
    constraints: ["Retornar apenas JSON válido."],
    expectedOutput: "json",
    ...overrides,
  };
}

test("primeira chamada: gera pacote de trabalho em disco e lança DeveloperAssistancePendingError (workflow deve pausar)", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    await assert.rejects(() => provider.request(mariaRequest()), (error) => {
      assert.ok(error instanceof DeveloperAssistancePendingError);
      assert.equal(error.workPackage.specialistId, "maria-copywriting");
      assert.equal(error.workPackage.executionId, "execution-A");
      assert.equal(error.workPackage.taskId, "step-0003");
      return true;
    });

    const written = await artifactDelivery.readFile({
      executionId: "execution-A",
      relativePath: "icaro/step-0003-maria-copywriting.package.json",
    });
    assert.ok(written, "o pacote de trabalho deveria ter sido salvo em disco");
  });
});

test("pacote de trabalho contém prompt completo, contexto e schema esperado", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    let workPackage;
    try {
      await provider.request(mariaRequest());
    } catch (error) {
      workPackage = error.workPackage;
    }

    assert.ok(workPackage);
    assert.equal(workPackage.prompt, "Escreva uma copy sobre a lista de presentes com taxa zero.");
    assert.deepEqual(workPackage.context, { clientId: "client-rumo", channel: "instagram" });
    assert.ok(Array.isArray(workPackage.responseSchema));
    assert.ok(workPackage.responseSchema.some((field) => field.field === "caption"));
    assert.ok(workPackage.responseSchema.some((field) => field.field === "title"));
    assert.equal(workPackage.expectedResponsePath, "icaro/step-0003-maria-copywriting.response.json");
    assert.equal(workPackage.resumeCommand, "npm run zuno -- --continue execution-A");
    assert.ok(typeof workPackage.instruction === "string" && workPackage.instruction.length > 0);

    const persisted = await artifactDelivery.readFile({ executionId: "execution-A", relativePath: workPackage.workPackagePath });
    const persistedJson = JSON.parse(Buffer.from(persisted.data).toString("utf8"));
    assert.equal(persistedJson.prompt, workPackage.prompt);
    assert.deepEqual(persistedJson.responseSchema, workPackage.responseSchema);
  });
});

test("resposta válida salva pela IA desenvolvedora permite retomada (status completed, provider developer-ai-assisted)", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    await assert.rejects(() => provider.request(mariaRequest()));

    await artifactDelivery.writeFile({
      executionId: "execution-A",
      relativePath: "icaro/step-0003-maria-copywriting.response.json",
      content: JSON.stringify({
        title: "Presentear ficou fácil",
        caption: "Uma legenda real, escrita pela IA desenvolvedora para validar o fluxo.",
        cta: "Conheça o Rumo ao Altar",
        hashtags: ["#RumoAoAltar", "#TaxaZero"],
      }),
      provenance: FAKE_HUMAN_RESPONSE_PROVENANCE,
    });

    const response = await provider.request(mariaRequest());
    assert.equal(response.status, "completed");
    assert.equal(response.provider.id, "developer-ai-assisted");
    const content = JSON.parse(String(response.content));
    assert.equal(content.caption, "Uma legenda real, escrita pela IA desenvolvedora para validar o fluxo.");
  });
});

test("JSON inválido no arquivo de resposta é rejeitado (pausa de novo, com erro de validação explicado)", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    await assert.rejects(() => provider.request(mariaRequest()));
    await artifactDelivery.writeFile({
      executionId: "execution-A",
      relativePath: "icaro/step-0003-maria-copywriting.response.json",
      content: "isto não é um JSON válido {{{",
      provenance: FAKE_HUMAN_RESPONSE_PROVENANCE,
    });

    await assert.rejects(() => provider.request(mariaRequest()), (error) => {
      assert.ok(error instanceof DeveloperAssistancePendingError);
      assert.ok(error.workPackage.validationErrors.some((message) => message.toLowerCase().includes("json válido")));
      return true;
    });
  });
});

test("resposta sem o campo obrigatório da Maria (caption) é rejeitada", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    await assert.rejects(() => provider.request(mariaRequest()));
    await artifactDelivery.writeFile({
      executionId: "execution-A",
      relativePath: "icaro/step-0003-maria-copywriting.response.json",
      content: JSON.stringify({ title: "Só título, sem legenda" }),
      provenance: FAKE_HUMAN_RESPONSE_PROVENANCE,
    });

    await assert.rejects(() => provider.request(mariaRequest()), (error) => {
      assert.ok(error instanceof DeveloperAssistancePendingError);
      assert.ok(error.workPackage.validationErrors.some((message) => message.includes("caption")));
      return true;
    });
  });
});

test("objeto JSON vazio é rejeitado", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    await assert.rejects(() => provider.request(mariaRequest()));
    await artifactDelivery.writeFile({
      executionId: "execution-A",
      relativePath: "icaro/step-0003-maria-copywriting.response.json",
      content: "{}",
      provenance: FAKE_HUMAN_RESPONSE_PROVENANCE,
    });

    await assert.rejects(() => provider.request(mariaRequest()), (error) => {
      assert.ok(error instanceof DeveloperAssistancePendingError);
      assert.ok(error.workPackage.validationErrors.length > 0);
      return true;
    });
  });
});

test("resposta salva para outra execução não é aceita (isolamento por executionId)", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    // Execução A recebe e valida uma resposta legítima.
    await assert.rejects(() => provider.request(mariaRequest({ executionId: "execution-A" })));
    await artifactDelivery.writeFile({
      executionId: "execution-A",
      relativePath: "icaro/step-0003-maria-copywriting.response.json",
      content: JSON.stringify({ title: "A", caption: "Legenda da execução A." }),
      provenance: FAKE_HUMAN_RESPONSE_PROVENANCE,
    });
    const responseA = await provider.request(mariaRequest({ executionId: "execution-A" }));
    assert.equal(responseA.status, "completed");

    // Execução B, mesmo taskId/specialistId, não deve enxergar a resposta de A — continua pendente.
    await assert.rejects(() => provider.request(mariaRequest({ executionId: "execution-B" })), (error) => {
      assert.ok(error instanceof DeveloperAssistancePendingError);
      assert.equal(error.workPackage.executionId, "execution-B");
      return true;
    });
  });
});

test("cada peça mantém seu próprio pacote de trabalho até Maria e Sofia: temas diferentes (RSVP, álbum, cronograma, taxa zero) geram pacotes distintos com prompts distintos", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    const themes = [
      { taskId: "step-rsvp", prompt: "Crie uma copy sobre RSVP e confirmação de presença." },
      { taskId: "step-album", prompt: "Crie uma copy sobre o álbum colaborativo de fotos." },
      { taskId: "step-cronograma", prompt: "Crie uma copy sobre o cronograma do casamento." },
      { taskId: "step-taxa-zero", prompt: "Crie uma copy sobre a lista de presentes com taxa zero." },
    ];

    const packages = [];
    for (const theme of themes) {
      try {
        await provider.request(mariaRequest({ executionId: "execution-campaign", taskId: theme.taskId, prompt: theme.prompt }));
      } catch (error) {
        packages.push(error.workPackage);
      }
    }

    const paths = packages.map((pkg) => pkg.workPackagePath);
    assert.equal(new Set(paths).size, paths.length, "cada tema deveria gerar um caminho de pacote próprio");

    const prompts = packages.map((pkg) => pkg.prompt);
    assert.equal(new Set(prompts).size, prompts.length, "cada tema deveria manter seu prompt próprio, sem se misturar com os demais");
  });
});

test("especialista sem schema conhecido (futura Skill que use IcaroBrainPort) ainda funciona: aceita qualquer objeto não vazio com conteúdo real", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    const request = {
      taskType: "analysis",
      prompt: "Prompt de uma Skill futura qualquer.",
      specialistId: "futura-skill-desconhecida",
      executionId: "execution-futura",
      taskId: "step-0001",
    };

    await assert.rejects(() => provider.request(request));
    await artifactDelivery.writeFile({
      executionId: "execution-futura",
      relativePath: "icaro/step-0001-futura-skill-desconhecida.response.json",
      content: JSON.stringify({ algumCampoQualquer: "conteúdo real e não vazio" }),
      provenance: FAKE_HUMAN_RESPONSE_PROVENANCE,
    });

    const response = await provider.request(request);
    assert.equal(response.status, "completed");
    assert.equal(response.provider.id, "developer-ai-assisted");
  });
});

test("executionId ou taskId ausentes falham alto (erro de configuração, não de pausa)", async () => {
  await withArtifactsDir(async (artifactsDir) => {
    const artifactDelivery = new LocalArtifactDelivery({ rootDir: artifactsDir });
    const provider = new DeveloperAssistedIcaroProvider({ artifactDelivery });

    await assert.rejects(
      () => provider.request({ taskType: "analysis", prompt: "x", specialistId: "joao-marketing-strategy" }),
      (error) => {
        assert.ok(!(error instanceof DeveloperAssistancePendingError));
        return true;
      },
    );
  });
});
