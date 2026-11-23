"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Proteção por seção do Início (Fase 3): um erro inesperado ao desenhar UMA área mostra um aviso
 * só naquele lugar — o resto da página continua funcionando.
 */
export class SectionBoundary extends Component<{ label: string; compact?: boolean; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Início] falha ao exibir ${this.props.label}`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className={this.props.compact ? "flex min-h-[112px] items-center rounded-2xl border border-dashed border-border p-3.5 text-xs text-muted-foreground" : "rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground"}>
        <span>
          Não foi possível exibir {this.props.label}.{" "}
          <button type="button" className="font-semibold text-primary hover:underline dark:text-primary-glow" onClick={() => this.setState({ failed: false })}>
            Tentar de novo
          </button>
        </span>
      </div>
    );
  }
}
