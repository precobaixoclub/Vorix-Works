import { ImageResponse } from "next/og";

export const alt = "Proposta comercial — confira os detalhes e as condições";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function ProposalImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", padding: 48, background: "#eaf4ee", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", padding: "48px 56px", background: "#ffffff", borderRadius: 24, border: "1px solid #d5e4da", boxShadow: "0 12px 36px #173f2510" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", color: "#236847", background: "#edf6ef", padding: "12px 18px", borderRadius: 12, fontSize: 20, letterSpacing: 2 }}>PROPOSTA COMERCIAL</div>
          <div style={{ display: "flex", fontSize: 27, fontWeight: 700, color: "#173f2b" }}>vorix.</div>
        </div>
        <div style={{ display: "flex", marginTop: 46, fontSize: 62, fontWeight: 700, color: "#163829", letterSpacing: -2 }}>Uma proposta para você.</div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 28, lineHeight: 1.5, color: "#65766c", maxWidth: 800 }}>Todos os detalhes, valores e condições, organizados em um só lugar.</div>
        <div style={{ display: "flex", alignItems: "center", marginTop: "auto", paddingTop: 36, justifyContent: "space-between", borderTop: "1px solid #e8eee9" }}>
          <div style={{ display: "flex", fontSize: 22, color: "#64746b" }}>Confira com calma. Conte com a gente.</div>
          <div style={{ display: "flex", padding: "15px 24px", borderRadius: 12, background: "#236847", color: "#ffffff", fontSize: 23, fontWeight: 600 }}>Ver proposta →</div>
        </div>
      </div>
    </div>, size,
  );
}
