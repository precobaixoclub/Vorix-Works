"use client";

import { useEffect } from "react";
import { trackProductEvent, type ClientProductEventName } from "@/lib/product-events";

/**
 * Ponte mínima pra disparar um evento comportamental (`landing_view`/`pricing_view`) a partir de
 * uma página server-rendered (`page.tsx` sem "use client") — o disparo em si precisa rodar no
 * navegador (persistência de `anonymousId`, `fetch`), então isola isso num Client Component sem
 * UI própria (`null`), montado uma vez dentro da página.
 */
export function TrackPageView({ eventName, properties }: { eventName: ClientProductEventName; properties?: Record<string, unknown> }) {
  useEffect(() => {
    trackProductEvent(eventName, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName]);
  return null;
}
