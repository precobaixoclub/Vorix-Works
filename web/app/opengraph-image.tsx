import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(135deg,#070b12 0%,#0b1320 58%,#101827 100%)",
          color: "white",
          fontFamily: "Inter, Arial, sans-serif",
          padding: 62,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 520,
            height: 520,
            borderRadius: 520,
            background: "rgba(173,219,70,0.18)",
            filter: "blur(16px)",
            top: -180,
            left: -120,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", width: 500 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 38, fontWeight: 800 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: "#addb46" }} />
            Vorix
          </div>
          <div style={{ marginTop: 76, fontSize: 64, lineHeight: 1.03, fontWeight: 760 }}>
            Marketing, atendimento e vendas conectados por IA.
          </div>
          <div style={{ marginTop: 26, color: "#cbd5e1", fontSize: 25, lineHeight: 1.35 }}>
            Uma operacao inteira no mesmo Command Center.
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 58,
            top: 86,
            width: 560,
            height: 430,
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "#0a101a",
            boxShadow: "0 28px 70px rgba(0,0,0,0.38)",
            padding: 22,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 20, fontWeight: 700 }}>
            Command Center
            <div style={{ borderRadius: 999, background: "rgba(173,219,70,0.16)", color: "#d7ff74", padding: "7px 12px", fontSize: 15 }}>IA integrada</div>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {["Conversas", "Pipeline", "Follow-ups"].map((label, index) => (
              <div key={label} style={{ flex: 1, borderRadius: 12, background: "#111a29", padding: 16, display: "flex", flexDirection: "column" }}>
                <div style={{ color: "#94a3b8", fontSize: 16 }}>{label}</div>
                <div style={{ marginTop: 14, fontSize: 34, fontWeight: 780 }}>{["12", "R$ 48k", "8"][index]}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 16, flex: 1 }}>
            <div style={{ flex: 1.05, borderRadius: 12, background: "#111a29", padding: 16, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Prioridades</div>
              {["Lead quente sem resposta", "Proposta visualizada", "Tarefa atrasada"].map((item) => (
                <div key={item} style={{ marginTop: 13, borderRadius: 10, background: "rgba(255,255,255,0.05)", padding: 13, color: "#e2e8f0", fontSize: 16 }}>
                  {item}
                </div>
              ))}
            </div>
            <div style={{ flex: 0.95, borderRadius: 12, background: "#111a29", padding: 16, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Pipeline</div>
              <div style={{ display: "flex", gap: 9, marginTop: 14, height: 210 }}>
                {["Novo", "Proposta", "Ganho"].map((item) => (
                  <div key={item} style={{ flex: 1, borderRadius: 10, background: "rgba(255,255,255,0.05)", padding: 10, color: "#94a3b8", fontSize: 14 }}>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
