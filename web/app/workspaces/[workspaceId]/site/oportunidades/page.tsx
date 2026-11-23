"use client";
import DealsPage from "../../deals/page";
import { SiteCrmRoute } from "@/components/sales/SiteCrmRoute";
/** Oportunidades (as mesmas do CRM — pedidos do carrinho viram oportunidades). Com Conversas, encaminha para Vendas › Oportunidades (Fase 7). */
export default function SiteDealsPage(){return <SiteCrmRoute crmPath="/deals"><DealsPage/></SiteCrmRoute>;}
