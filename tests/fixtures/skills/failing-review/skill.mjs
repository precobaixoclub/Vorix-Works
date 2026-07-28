export const skill = {
  manifest: {
    id: "failing-review",
    name: "Failing Review Test Double",
    version: "0.1.0",
    description: "Dublê que falha na execução.",
    author: "Zuno Tests",
    capabilities: ["quality_review"],
    inputs: [{ name: "draft", description: "Conteúdo para revisar." }],
    outputs: [{ name: "review", description: "Resultado de revisão fake." }],
    dependencies: [],
    status: "experimental",
    enabled: true,
    compatibility: { zuno: "^0.1.0" },
    runtime: { entrypoint: "./skill.mjs" },
    responsibilityBoundary: {
      allowed: ["Falhar durante teste."],
      forbidden: ["Chamar outra Skill diretamente."],
    },
    owner: "helena-managed",
  },
  async execute() {
    throw new Error("Falha controlada da Skill de teste.");
  },
};
