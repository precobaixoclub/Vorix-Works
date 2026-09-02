export type NavIconId =
  | "home"
  | "create"
  | "production"
  | "content"
  | "calendar"
  | "publish"
  | "connections"
  | "ads"
  | "messages"
  | "conversas"
  | "brand"
  | "analytics"
  | "settings"
  | "planning"
  | "runtime"
  | "execution"
  | "publication-technical"
  | "providers"
  | "governance"
  | "operations"
  | "menu";

const GEAR_TEETH_ANGLES = [0, 60, 120, 180, 240, 300];

export function NavIcon({ id, className = "h-[18px] w-[18px]" }: { id: NavIconId; className?: string }) {
  const shared = { viewBox: "0 0 16 16", fill: "none", className, "aria-hidden": true } as const;
  const stroke = { stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (id) {
    case "home":
      return (
        <svg {...shared}>
          <path d="M2.3 7.8L8 3l5.7 4.8" {...stroke} />
          <path d="M3.8 6.6V13a.8.8 0 00.8.8h6.8a.8.8 0 00.8-.8V6.6" {...stroke} />
        </svg>
      );
    case "create":
      return (
        <svg {...shared}>
          <path d="M8 3v10M3 8h10" {...stroke} />
        </svg>
      );
    case "production":
      return (
        <svg {...shared}>
          <path d="M8 2.3l5.6 3-5.6 3-5.6-3L8 2.3z" {...stroke} strokeLinejoin="round" />
          <path d="M2.4 8.3L8 11.3l5.6-3" {...stroke} />
          <path d="M2.4 10.8L8 13.8l5.6-3" {...stroke} />
        </svg>
      );
    case "content":
      return (
        <svg {...shared}>
          <rect x="2.2" y="2.2" width="4.8" height="4.8" rx="1" {...stroke} />
          <rect x="9" y="2.2" width="4.8" height="4.8" rx="1" {...stroke} />
          <rect x="2.2" y="9" width="4.8" height="4.8" rx="1" {...stroke} />
          <rect x="9" y="9" width="4.8" height="4.8" rx="1" {...stroke} />
        </svg>
      );
    case "calendar":
      return (
        <svg {...shared}>
          <rect x="2.2" y="3.2" width="11.6" height="10.4" rx="1.6" {...stroke} />
          <path d="M2.2 6.4h11.6" {...stroke} />
          <path d="M5.4 1.8v3M10.6 1.8v3" {...stroke} />
        </svg>
      );
    case "publish":
      return (
        <svg {...shared}>
          <path d="M8 10V2.6M5 5.4L8 2.4l3 3" {...stroke} />
          <path d="M2.6 10.8v1.8a1 1 0 001 1h8.8a1 1 0 001-1v-1.8" {...stroke} />
        </svg>
      );
    case "connections":
      return (
        <svg {...shared}>
          <circle cx="5.6" cy="6" r="2.6" {...stroke} />
          <circle cx="10.4" cy="10" r="2.6" {...stroke} />
        </svg>
      );
    case "ads":
      return (
        <svg {...shared}>
          <path d="M2.4 6.2h2.4l5-3.2v10l-5-3.2H2.4a1 1 0 01-1-1V7.2a1 1 0 011-1z" {...stroke} strokeLinejoin="round" />
          <path d="M6.6 11.4l1 2.6" {...stroke} />
          <path d="M11.6 6a2.4 2.4 0 010 4" {...stroke} />
        </svg>
      );
    case "messages":
      return (
        <svg {...shared}>
          <path d="M2.4 3.6a1 1 0 011-1h9.2a1 1 0 011 1v6.4a1 1 0 01-1 1H7.2l-3 2.4v-2.4H3.4a1 1 0 01-1-1V3.6z" {...stroke} strokeLinejoin="round" />
        </svg>
      );
    case "conversas":
      return (
        <svg {...shared}>
          <path d="M2.2 3.4a1 1 0 011-1h6.4a1 1 0 011 1v4.4a1 1 0 01-1 1H6.2l-2.4 2v-2h-.6a1 1 0 01-1-1V3.4z" {...stroke} strokeLinejoin="round" />
          <path d="M8.4 6h4.4a1 1 0 011 1v4.4a1 1 0 01-1 1h-.4v2l-2.4-2H8.4a1 1 0 01-1-1V10" {...stroke} strokeLinejoin="round" />
        </svg>
      );
    case "brand":
      return (
        <svg {...shared}>
          <path d="M8 2L14 8L8 14L2 8Z" {...stroke} strokeLinejoin="round" />
        </svg>
      );
    case "analytics":
      return (
        <svg {...shared}>
          <path d="M3 13.5V8.2M8 13.5V4M13 13.5V6.6" {...stroke} />
          <path d="M2 13.9h12" {...stroke} />
        </svg>
      );
    case "settings":
      // Dentes desenhados como traços (stroke), nunca `fill` sólido — mesmo peso visual do
      // restante do set (achado de auditoria: fill quebrava a consistência do ícone no menu).
      return (
        <svg {...shared}>
          <circle cx="8" cy="8" r="2.4" {...stroke} />
          {GEAR_TEETH_ANGLES.map((angle) => (
            <line key={angle} x1="8" y1="1.6" x2="8" y2="3.4" {...stroke} transform={`rotate(${angle} 8 8)`} />
          ))}
        </svg>
      );
    case "planning":
      return (
        <svg {...shared}>
          <rect x="3.4" y="2.6" width="9.2" height="11.2" rx="1.4" {...stroke} />
          <path d="M6 2.2a1 1 0 011-1h2a1 1 0 011 1v.8H6v-.8z" {...stroke} />
          <path d="M5.8 8l1.4 1.4L10.4 6.2" {...stroke} />
        </svg>
      );
    case "runtime":
      return (
        <svg {...shared}>
          <path d="M2 8.4h2.2l1.2-3.4L8.6 12l1.4-3.6H14" {...stroke} strokeLinejoin="round" />
        </svg>
      );
    case "execution":
      return (
        <svg {...shared}>
          <path d="M5.6 3.6v8.8L12 8z" {...stroke} strokeLinejoin="round" />
        </svg>
      );
    case "publication-technical":
      return (
        <svg {...shared}>
          <rect x="2.4" y="2.6" width="11.2" height="10.8" rx="1.4" {...stroke} />
          <path d="M4.8 5.8h6.4M4.8 8.2h6.4M4.8 10.6h4" {...stroke} />
        </svg>
      );
    case "providers":
      return (
        <svg {...shared}>
          <path d="M6 2.4v3.2M10 2.4v3.2" {...stroke} />
          <rect x="4.4" y="5.6" width="7.2" height="4.2" rx="1.2" {...stroke} />
          <path d="M8 9.8v3.2" {...stroke} />
        </svg>
      );
    case "governance":
      return (
        <svg {...shared}>
          <path d="M8 1.8l5 1.9v3.5c0 3.3-2.1 6-5 6.8-2.9-.8-5-3.5-5-6.8V3.7l5-1.9z" {...stroke} strokeLinejoin="round" />
        </svg>
      );
    case "operations":
      return (
        <svg {...shared}>
          <path d="M2.6 11.2a5.4 5.4 0 0110.8 0" {...stroke} />
          <path d="M8 11.2l2.6-3.8" {...stroke} />
          <circle cx="8" cy="11.2" r="0.9" {...stroke} />
        </svg>
      );
    case "menu":
      return (
        <svg {...shared}>
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" {...stroke} />
        </svg>
      );
    default:
      return (
        <svg {...shared}>
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
