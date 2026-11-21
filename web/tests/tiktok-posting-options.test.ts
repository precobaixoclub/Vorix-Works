import { describe, expect, it } from "vitest";
import { EMPTY_TIKTOK_OPTIONS, tiktokPostingBlocker } from "../features/tiktok/TikTokPostSettings";
import type { TikTokCreatorInfo } from "../features/tiktok/types";
const creator: TikTokCreatorInfo = { credentialReferenceId: "c", creatorNickname: "My account", creatorUsername: "me", privacyLevelOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], commentDisabled: true, duetDisabled: true, stitchDisabled: true, maxVideoPostDurationSec: 60, sandbox: false };
describe("TikTok post requirements", () => {
  it("never infers privacy or music agreement", () => {
    expect(EMPTY_TIKTOK_OPTIONS.privacyLevel).toBe("");
    expect(EMPTY_TIKTOK_OPTIONS.musicUsageAccepted).toBe(false);
    expect(tiktokPostingBlocker(EMPTY_TIKTOK_OPTIONS, creator, false)).toContain("privacidade");
    expect(tiktokPostingBlocker({ ...EMPTY_TIKTOK_OPTIONS, privacyLevel: "SELF_ONLY" }, creator, false)).toContain("termos");
  });
  it("blocks invalid commercial and private branded content combinations", () => {
    const options = { ...EMPTY_TIKTOK_OPTIONS, privacyLevel: "SELF_ONLY" as const, musicUsageAccepted: true, commercialContent: true };
    expect(tiktokPostingBlocker(options, creator, false)).toContain("promove");
    expect(tiktokPostingBlocker({ ...options, brandOrganic: true }, creator, false)).toBeUndefined();
    expect(tiktokPostingBlocker({ ...options, brandContent: true }, creator, false)).toContain("Parcerias");
    expect(tiktokPostingBlocker({ ...options, privacyLevel: "PUBLIC_TO_EVERYONE", brandContent: true }, creator, false)).toBeUndefined();
  });
  it("checks actual creator privacy options, sandbox visibility and video duration", () => {
    const options = { ...EMPTY_TIKTOK_OPTIONS, privacyLevel: "SELF_ONLY" as const, musicUsageAccepted: true };
    expect(tiktokPostingBlocker(options, undefined, false)).toContain("permissões");
    expect(tiktokPostingBlocker({ ...options, privacyLevel: "FOLLOWER_OF_CREATOR" }, creator, false)).toContain("privacidade");
    expect(tiktokPostingBlocker({ ...options, privacyLevel: "PUBLIC_TO_EVERYONE" }, { ...creator, sandbox: true }, false)).toContain("Só eu");
    expect(tiktokPostingBlocker(options, creator, true, 60.1)).toContain("60 segundos");
    expect(tiktokPostingBlocker(options, creator, true)).toContain("duração");
    expect(tiktokPostingBlocker(options, creator, true, 59.9)).toBeUndefined();
  });
});
