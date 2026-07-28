export const skill = {
  manifest: {
    id: "ready-copy",
    name: "Ready Copy Test Double",
    version: "0.1.0",
    description: "Dublê de teste para capability de copywriting.",
    author: "Zuno Tests",
    capabilities: ["copywriting"],
    inputs: [{ name: "briefing", description: "Briefing recebido para teste." }],
    outputs: [{ name: "draft", description: "Resposta fake de copy." }],
    dependencies: [],
    status: "experimental",
    enabled: true,
    compatibility: { zuno: "^0.1.0" },
    runtime: { entrypoint: "./skill.mjs" },
    responsibilityBoundary: {
      allowed: ["Responder como dublê de teste."],
      forbidden: ["Chamar outra Skill diretamente."],
    },
    owner: "helena-managed",
  },
  async execute(request) {
    return {
      skillId: "ready-copy",
      taskId: request.context.taskId,
      status: "completed",
      output: { receivedBy: request.context.requestedBy, orchestratedBy: request.context.orchestratedBy },
      artifacts: [],
      warnings: [],
    };
  },
};
