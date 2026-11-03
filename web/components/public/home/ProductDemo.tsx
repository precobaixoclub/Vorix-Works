"use client";
import { useId, useState, type KeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, Play, X } from "lucide-react";
import { HOME_PRODUCTS, type HomeProductKey } from "./content";
import { MarketingImage } from "./MarketingImage";

export function ProductDemo({
  initial = "conversations",
  label = "Ver demonstração",
  className = "vh-button vh-button-outline",
}: {
  initial?: HomeProductKey;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(initial);
  const id = useId();
  const product = HOME_PRODUCTS.find((item) => item.key === active)!;
  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = HOME_PRODUCTS.findIndex((item) => item.key === active);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 3
          : (index + (event.key === "ArrowRight" ? 1 : 3)) % 4;
    setActive(HOME_PRODUCTS[next].key);
    document.getElementById(`${id}-${HOME_PRODUCTS[next].key}`)?.focus();
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={className}>
          <Play size={15} aria-hidden="true" />
          {label}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="vh-demo-overlay" />
        <Dialog.Content className="vh-demo-dialog">
          <div className="vh-demo-heading">
            <div>
              <Dialog.Title>Conheça o Vorix por dentro.</Dialog.Title>
              <Dialog.Description>
                Telas reais da plataforma, com dados demonstrativos sanitizados.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="vh-icon-button"
              aria-label="Fechar demonstração"
            >
              <X size={21} />
            </Dialog.Close>
          </div>
          <div
            className="vh-demo-tabs"
            role="tablist"
            aria-label="Produtos da demonstração"
          >
            {HOME_PRODUCTS.map(({ key, short, Icon }) => (
              <button
                key={key}
                type="button"
                id={`${id}-${key}`}
                role="tab"
                aria-selected={active === key}
                aria-controls={`${id}-panel`}
                tabIndex={active === key ? 0 : -1}
                onClick={() => setActive(key)}
                onKeyDown={onKey}
              >
                <Icon size={16} />
                {short}
              </button>
            ))}
          </div>
          {open ? (
            <div
              id={`${id}-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-${active}`}
              className="vh-demo-panel"
            >
              <MarketingImage
                asset={product.image}
                alt={`Tela real do ${product.name} com dados demonstrativos`}
                sizes="(max-width: 767px) 94vw, 1000px"
              />
              <div>
                <p>
                  <strong>{product.name}</strong> · {product.status}
                </p>
                <a
                  href={
                    product.key === "marketing" ? "/#marketing" : product.href
                  }
                  onClick={() => setOpen(false)}
                >
                  Conhecer o produto <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
