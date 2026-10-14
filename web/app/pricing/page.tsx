import { redirect } from "next/navigation";

// Preserve existing acquisition links while keeping one public pricing page.
export default function PricingPage() { redirect("/precos"); }
