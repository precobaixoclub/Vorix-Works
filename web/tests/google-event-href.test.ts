import { describe, expect, it } from "vitest";
import { googleEventHref } from "@/features/meetings/agenda";

describe("googleEventHref", () => {
  const link = "https://www.google.com/calendar/event?eid=abc123";

  it("opens the event in the connected Google account (authuser)", () => {
    const url = new URL(googleEventHref(link, "suporte@empresa.com"));
    expect(url.searchParams.get("eid")).toBe("abc123");
    expect(url.searchParams.get("authuser")).toBe("suporte@empresa.com");
  });

  it("keeps the link as is without a known account or with a malformed link", () => {
    expect(googleEventHref(link)).toBe(link);
    expect(googleEventHref("not a url", "a@b.com")).toBe("not a url");
  });
});
