"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { simulateCapacity, type CapacityRecommendation } from "@/features/platform-plans/api";

/**
 * Simulador público de capacidade (seção 27 do pedido) — visitante informa usuários/números,
 * backend calcula a melhor opção (`POST /v1/platform/plans/simulate`, mesmo `recommendBestPlan` do
 * preview autenticado). Nunca calcula nada no cliente — só formata o que a API já devolve pronto.
 */
export function CapacitySimulator() {
  const [users, setUsers] = useState(5);
  const [whatsappConnections, setWhatsappConnections] = useState(2);
  const [result, setResult] = useState<CapacityRecommendation | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSimulate() {
    setLoading(true);
    setError(undefined);
    try {
      const recommendation = await simulateCapacity({ users, whatsappConnections });
      setResult(recommendation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível calcular.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Personalize conforme sua operação</p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <Stepper label="Quantos usuários?" value={users} onChange={setUsers} min={1} />
        <Stepper label="Quantos números conectados?" value={whatsappConnections} onChange={setWhatsappConnections} min={1} />
      </div>
      <Button className="mt-4 w-full sm:w-auto" onClick={handleSimulate} disabled={loading}>
        {loading ? "Calculando..." : "Calcular"}
      </Button>

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

      {result?.recommended ? (
        <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm text-muted-foreground">Para sua estrutura, recomendamos</p>
          <p className="mt-1 text-2xl font-semibold">{result.recommended.planCode}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.recommended.additionalUsers > 0 ? `+${result.recommended.additionalUsers} usuário(s) · ` : ""}
            {result.recommended.additionalWhatsappConnections > 0 ? `+${result.recommended.additionalWhatsappConnections} número(s) · ` : ""}
            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: result.recommended.currency }).format(result.recommended.totalMonthlyAmount)}/mês
          </p>
          <Link href={`/signup?plan=${result.recommended.planCode}`}>
            <Button className="mt-3">Testar {result.recommended.planCode} por 7 dias</Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Stepper({ label, value, onChange, min }: { label: string; value: number; onChange: (value: number) => void; min: number }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-muted"
          aria-label="Diminuir"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-10 text-center text-lg font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-muted"
          aria-label="Aumentar"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
