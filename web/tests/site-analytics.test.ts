import {describe,it,expect} from "vitest";
import {analyticsQuery,displayConversion,siteMetric} from "../features/sites/analytics";
describe("Site analytics presentation",()=>{
 it("does not invent conversion without a denominator",()=>{expect(displayConversion(null)).toBe("—");expect(displayConversion(0)).toBe("0%");expect(displayConversion(33.33)).toBe("33,33%");});
 it("encodes workspace and UTM filters and omits empty values",()=>{const query=analyticsQuery("workspace&one",{source:"social & search",campaign:"",siteId:"site/one"});expect(new URLSearchParams(query).get("workspaceId")).toBe("workspace&one");expect(new URLSearchParams(query).get("source")).toBe("social & search");expect(new URLSearchParams(query).has("campaign")).toBe(false);});
 it("distinguishes views from unique visitors and supports missing future metrics",()=>{const group={metrics:{SITE_VIEW:{count:10,visitors:2}}};expect(siteMetric(group,"SITE_VIEW")).toBe(10);expect(siteMetric(group,"SITE_VIEW",true)).toBe(2);expect(siteMetric(group,"ORDER")).toBe(0);});
});
