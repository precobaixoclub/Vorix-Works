"use client";
import ProductsPage from "../../products/page";
import { SiteCrmRoute } from "@/components/sales/SiteCrmRoute";
/** O Site edita o catálogo existente (o mesmo do CRM). Com Conversas, encaminha para Vendas › Produtos (Fase 7). */
export default function SiteProductsPage(){return <SiteCrmRoute crmPath="/products"><ProductsPage/></SiteCrmRoute>;}
