"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SettingsShell } from "@/components/settings/SettingsShell";
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
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | "new" | undefined>();
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products ?? [];
    return (products ?? []).filter((product) => product.name.toLowerCase().includes(query));
  }, [products, search]);

  async function saveProduct(input: { name: string; priceCents: number }) {
    setBusy(true);
    setActionError(undefined);
    try {
      if (editing === "new") await createProduct({ workspaceId: workspace.id, name: input.name, priceCents: input.priceCents });
      else if (editing) await updateProduct(editing.id, workspace.id, { name: input.name, priceCents: input.priceCents });
      setEditing(undefined);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível salvar o produto.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(product: Product) {
    setTogglingId(product.id);
    setActionError(undefined);
    try {
      await updateProduct(product.id, workspace.id, { active: !product.active });
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível alterar o status.");
    } finally {
      setTogglingId(undefined);
    }
  }

  return (
    <SettingsShell
      active="products"
      title="Produtos e serviços"
      description="Catálogo comercial simples para propostas, sem complexidade de ERP."
      actions={<Button onClick={() => setEditing("new")}>Novo produto</Button>}
    >
      {actionError ? <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}
      <FilterBar summary={`${filtered.length} itens`}>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto ou serviço" aria-label="Buscar produto ou serviço" className="max-w-sm" />
      </FilterBar>

      <Card>
        <CardBody className="p-0">
          {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : null}
          {error ? <div className="p-5"><ErrorState error={error} onRetry={() => mutate()} /></div> : null}
          {!isLoading && !error && products && products.length === 0 ? (
            <div className="p-5"><EmptyState title="Nenhum produto ainda" description="Cadastre produtos ou serviços para usar em propostas." /></div>
          ) : null}
          {!isLoading && !error && products && products.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhum item encontrado.</TableCell></TableRow>
                ) : filtered.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium text-foreground">{product.name}</TableCell>
                    <TableCell className="text-muted-foreground">Serviço</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrencyCents(product.priceCents, product.currency)}</TableCell>
                    <TableCell><Badge variant={product.active ? "default" : "outline"}>{product.active ? "Ativo" : "Inativo"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setEditing(product)}>Editar</Button>
                        <Button variant="ghost" onClick={() => handleToggleActive(product)} loading={togglingId === product.id}>
                          {product.active ? "Desativar" : "Ativar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardBody>
      </Card>

      {editing ? (
        <ProductModal product={editing === "new" ? undefined : editing} busy={busy} onClose={() => setEditing(undefined)} onSave={saveProduct} />
      ) : null}
    </SettingsShell>
  );
}

function ProductModal({ product, busy, onClose, onSave }: { product?: Product; busy: boolean; onClose: () => void; onSave: (input: { name: string; priceCents: number }) => Promise<void> }) {
  const [name, setName] = useState(product?.name ?? "");
  const [priceReais, setPriceReais] = useState(product ? String(product.priceCents / 100).replace(".", ",") : "");

  function submit() {
    const cents = Math.round(Number(priceReais.replace(",", ".")) * 100) || 0;
    void onSave({ name: name.trim(), priceCents: cents });
  }

  return (
    <Modal title={product ? "Editar produto" : "Novo produto"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <Label htmlFor="product-name">Nome</Label>
          <Input id="product-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Consultoria mensal" />
        </div>
        <div>
          <Label htmlFor="product-price">Preço (R$)</Label>
          <Input id="product-price" value={priceReais} onChange={(event) => setPriceReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim() || busy}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}
