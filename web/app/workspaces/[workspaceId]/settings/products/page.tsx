"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createProduct, updateProduct } from "@/features/crm/api";
import { useProducts } from "@/features/crm/hooks";
import type { Product } from "@/features/crm/types";
import { formatCurrencyCents } from "@/lib/format";

export default function ProductsPage() {
  const workspace = useCurrentWorkspace();
  const { data: products, error, isLoading, mutate } = useProducts(workspace.id);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [priceReais, setPriceReais] = useState("");
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | undefined>();

  async function handleCreate() {
    setBusy(true);
    try {
      const cents = Math.round(Number(priceReais.replace(",", ".")) * 100) || 0;
      await createProduct({ workspaceId: workspace.id, name: name.trim(), priceCents: cents });
      setCreateOpen(false);
      setName("");
      setPriceReais("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(product: Product) {
    setTogglingId(product.id);
    try {
      await updateProduct(product.id, workspace.id, { active: !product.active });
      await mutate();
    } finally {
      setTogglingId(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Produtos e Serviços"
        description="Catálogo simples de preço — usado para montar propostas rapidamente."
        actions={<Button onClick={() => setCreateOpen(true)}>Novo produto</Button>}
      />

      <Card>
        <CardBody className="p-0">
          {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : null}
          {error ? <div className="p-5"><ErrorState error={error} onRetry={() => mutate()} /></div> : null}
          {!isLoading && !error && products && products.length === 0 ? (
            <div className="p-5"><EmptyState title="Nenhum produto ainda" description="Cadastre produtos ou serviços para usar em propostas." /></div>
          ) : null}
          {products && products.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium text-foreground">{product.name}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrencyCents(product.priceCents, product.currency)}</TableCell>
                    <TableCell><Badge variant={product.active ? "default" : "outline"}>{product.active ? "Ativo" : "Inativo"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" onClick={() => handleToggleActive(product)} loading={togglingId === product.id}>
                        {product.active ? "Desativar" : "Ativar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardBody>
      </Card>

      {createOpen ? (
        <Modal title="Novo produto" onClose={() => setCreateOpen(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="product-name">Nome</Label>
              <Input id="product-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Plano Mensal" />
            </div>
            <div>
              <Label htmlFor="product-price">Preço (R$)</Label>
              <Input id="product-price" value={priceReais} onChange={(event) => setPriceReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={handleCreate} loading={busy} disabled={!name.trim() || busy}>Criar</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
