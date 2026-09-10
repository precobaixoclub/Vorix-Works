"use client";

import Link from "next/link";
import { Button, type ButtonProps } from "@/components/Button";
import { trackProductEvent } from "@/lib/product-events";

export function PlanSelectLink({ planCode, className, variant, children }: { planCode: string; className?: string; variant?: ButtonProps["variant"]; children: React.ReactNode }) {
  const href = planCode === "FREE" ? "/signup" : `/signup?plan=${encodeURIComponent(planCode)}`;
  return (
    <Link href={href} className={className} onClick={() => trackProductEvent("plan_selected", { planKey: planCode })}>
      <Button className="w-full" variant={variant}>
        {children}
      </Button>
    </Link>
  );
}
