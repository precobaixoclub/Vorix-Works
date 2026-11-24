const http = require("node:http");

const plans = [
  ["START", "Start", 149, 1490, 2, 1, 500],
  ["PRO", "Pro", 299, 2990, 5, 2, 2500],
  ["BUSINESS", "Business", 599, 5990, 10, 5, 10_000],
].map(([code, name, monthlyPriceUsd, yearlyPriceUsd, includedUsers, includedWhatsappConnections, monthlyCreditsQuota]) => ({
  code, name, monthlyPriceUsd, yearlyPriceUsd, includedUsers, includedWhatsappConnections,
  monthlyCreditsQuota, trialDays: 7, currency: "BRL", tagline: "",
}));
const catalog = {
  plans,
  priceSource: "plan_versions",
  solutions: ["conversations", "meetings", "site"].map(key => ({ key, name: key, contractable: true })),
  addons: [
    { code: "extra_user", name: "Usuário adicional", resource: "users", monthlyPriceUsd: 39, currency: "BRL" },
    { code: "extra_whatsapp_connection", name: "WhatsApp adicional", resource: "messaging_connections", monthlyPriceUsd: 79, currency: "BRL" },
  ],
  meetingsOffer: {
    currency: "BRL", baseMonthlyPrice: 147, baseYearlyPrice: 1470, includedConcurrentRecordings: 1,
    additionalRecordingMonthlyPrice: 67, additionalRecordingYearlyPrice: 670,
  },
};

http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && ["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CSRF-Token");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  const reply = (status, payload) => response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/v1/platform/plans" && request.method === "GET") return reply(200, { ok: true, data: catalog });
  if (path === "/v1/platform/plans/simulate" && request.method === "POST") {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    try {
      const { users, whatsappConnections } = JSON.parse(raw);
      if (!Number.isInteger(users) || users < 1 || !Number.isInteger(whatsappConnections) || whatsappConnections < 1) throw new Error("invalid quantities");
      const options = plans.map(({ code, currency, monthlyPriceUsd, includedUsers, includedWhatsappConnections }) => {
        const additionalUsers = Math.max(0, users - includedUsers);
        const additionalWhatsappConnections = Math.max(0, whatsappConnections - includedWhatsappConnections);
        const userAddonMonthlyAmount = additionalUsers * catalog.addons[0].monthlyPriceUsd;
        const whatsappAddonMonthlyAmount = additionalWhatsappConnections * catalog.addons[1].monthlyPriceUsd;
        return {
          planCode: code, currency, baseMonthlyAmount: monthlyPriceUsd, includedUsers, includedWhatsappConnections,
          additionalUsers, additionalWhatsappConnections, userAddonMonthlyAmount, whatsappAddonMonthlyAmount,
          addonsMonthlyAmount: userAddonMonthlyAmount + whatsappAddonMonthlyAmount,
          totalMonthlyAmount: monthlyPriceUsd + userAddonMonthlyAmount + whatsappAddonMonthlyAmount, feasible: true,
        };
      });
      const recommended = [...options].sort((a, b) => a.totalMonthlyAmount - b.totalMonthlyAmount)[0];
      return reply(200, { ok: true, data: { options, recommended } });
    } catch {
      return reply(400, { ok: false, error: { code: "FIXTURE_INPUT", message: "Capacidade inválida" } });
    }
  }
  return reply(404, { ok: false, error: { code: "FIXTURE_ONLY", message: "Rota fora da API local de teste" } });
}).listen(Number(process.env.VORIX_FIXTURE_PORT ?? 3410), "localhost");
