"use client";

import { RequireAuth } from "@/components/RequireAuth";
import BillingSettingsPage from "@/features/billing/components/BillingSettingsPage";

export default function AccountBillingPage() {
  return <RequireAuth><BillingSettingsPage account /></RequireAuth>;
}
