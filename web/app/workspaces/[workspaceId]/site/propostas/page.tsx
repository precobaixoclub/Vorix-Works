"use client";
import ProposalsPage from "../../proposals/page";
import { SiteCrmRoute } from "@/components/sales/SiteCrmRoute";
/** Propostas (as mesmas do CRM). Com Conversas, encaminha para Vendas › Propostas (Fase 7). */
export default function SiteProposalsPage(){return <SiteCrmRoute crmPath="/proposals"><ProposalsPage/></SiteCrmRoute>;}
