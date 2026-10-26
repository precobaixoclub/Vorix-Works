import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "playwright-core";
import type { SocialHealthResult, SocialPublicationStatus, SocialPublishResult } from "../../../application/social/social-publishing-provider.port.js";
import type { SocialMusicTrack } from "../../../domain/social/social-publishing.model.js";
import { BrowserSocialDriver, type BrowserPublishInput } from "./browser-driver.js";
import { GatewayMutex, SocialBrowserPool } from "./browser-pool.js";
import { EncryptedGatewayStore } from "./encrypted-store.js";
import { GatewayError, type GatewayCredential, type GatewayFrame, type GatewayInteraction, type GatewayScope, type GatewayUserScope } from "./protocol.js";

type StoredSession = GatewayCredential & { cookies: Awaited<ReturnType<BrowserContext["cookies"]>>; updatedAt: string };
type Receipt = { externalAccountId: string; result: SocialPublishResult; createdAt: string };
type Flow = { scope: GatewayUserScope; page: Page; driver: BrowserSocialDriver; context: BrowserContext; close: () => Promise<void>; expiresAt: number };
type AccountInput = GatewayScope & { credentialReferenceId: string; externalAccountId?: string };

/** Single gateway replica owns the private volume and account locks (no distributed browser sessions). */
export class SocialGatewayService {
  private readonly flows = new Map<string, Flow>();
  private readonly mutex = new GatewayMutex();
  private readonly timer: NodeJS.Timeout;
  constructor(private readonly store: EncryptedGatewayStore, private readonly pool: SocialBrowserPool, private readonly options: { mediaOrigins: readonly string[]; flowTtlMs?: number; operationTimeoutMs?: number; driverFactory?: (network: GatewayScope["network"], page: Page, context: BrowserContext) => BrowserSocialDriver }) {
    this.timer = setInterval(() => { for (const [id, flow] of this.flows) if (flow.expiresAt <= Date.now()) { this.flows.delete(id); void flow.close(); } }, 10_000);
    this.timer.unref();
  }
  private driver(scope: GatewayScope, page: Page, context: BrowserContext): BrowserSocialDriver { return this.options.driverFactory?.(scope.network, page, context) ?? new BrowserSocialDriver(scope.network, page, context, this.options.mediaOrigins); }
  private key(scope: GatewayScope, suffix: string): string { return JSON.stringify([scope.tenantId, scope.workspaceId, scope.network, suffix]); }
  private flow(scope: GatewayUserScope, id: string): Flow {
    const flow = this.flows.get(id);
    if (!flow || flow.expiresAt <= Date.now() || this.key(flow.scope, flow.scope.userId) !== this.key(scope, scope.userId)) throw new GatewayError("NOT_FOUND");
    return flow;
  }
  async connect(scope: GatewayUserScope): Promise<{ flowId: string; expiresAt: string }> {
    return this.mutex.run(this.key(scope, `login:${scope.userId}`), async () => {
      // At most one interactive login per tenant/user/workspace/network; the global pool is also bounded.
      for (const [id, flow] of this.flows) if (this.key(flow.scope, flow.scope.userId) === this.key(scope, scope.userId)) { this.flows.delete(id); await flow.close(); }
      const lease = await this.pool.open();
      try {
        const page = await lease.context.newPage();
        const driver = this.driver(scope, page, lease.context);
        await driver.guardNetwork(); await driver.login();
        const id = randomUUID(); const expiresAt = Date.now() + (this.options.flowTtlMs ?? 10 * 60_000);
        this.flows.set(id, { scope, page, driver, ...lease, expiresAt });
        return { flowId: id, expiresAt: new Date(expiresAt).toISOString() };
      } catch { await lease.close(); throw new GatewayError("TEMPORARY_PLATFORM_ERROR"); }
    });
  }
  async frame(scope: GatewayUserScope, flowId: string): Promise<GatewayFrame> {
    return this.mutex.run(`flow:${flowId}`, async () => {
      const flow = this.flow(scope, flowId);
      const state = await flow.driver.securityState();
      // Passwords and security codes are never returned in the image or saved to disk.
      const bytes = await flow.page.screenshot({ type: "jpeg", quality: 65, mask: [flow.page.locator('input[type="password"], input[autocomplete="one-time-code"], input[name*="code" i], input[name*="otp" i]')], timeout: 10_000 });
      return { image: bytes.toString("base64"), width: 1280, height: 800, status: state === "CHECKPOINT_REQUIRED" ? "CHECKPOINT_REQUIRED" : "CONNECTING", expiresAt: new Date(flow.expiresAt).toISOString() };
    });
  }
  async interact(scope: GatewayUserScope, flowId: string, action: GatewayInteraction): Promise<{ accepted: true }> {
    return this.mutex.run(`flow:${flowId}`, async () => {
      const flow = this.flow(scope, flowId);
      // Human input only. No arbitrary URL, script, selector, file upload, or challenge solver.
      if (action.kind === "click") await flow.page.mouse.click(action.x, action.y);
      if (action.kind === "drag") { await flow.page.mouse.move(action.x, action.y); await flow.page.mouse.down(); try { await flow.page.mouse.move(action.toX, action.toY, { steps: 20 }); } finally { await flow.page.mouse.up(); } }
      if (action.kind === "text") await flow.page.keyboard.insertText(action.text);
      if (action.kind === "key") await flow.page.keyboard.press(action.key);
      if (action.kind === "scroll") await flow.page.mouse.wheel(0, action.delta);
      return { accepted: true };
    });
  }
  async finish(scope: GatewayUserScope, flowId: string): Promise<GatewayCredential> {
    return this.mutex.run(`flow:${flowId}`, async () => {
      const flow = this.flow(scope, flowId);
      const identity = await flow.driver.identity();
      const credentialReferenceId = `socgw-${randomUUID()}`;
      const credential: GatewayCredential = { ...identity, credentialReferenceId, network: scope.network, status: "active" };
      // Persist only authenticated cookies. Form values, passwords, MFA, recovery codes, history,
      // browser cache, and localStorage are deliberately excluded.
      const cookies = (await flow.context.cookies()).filter(c => !/password|passwd|recovery|otp_code|mfa_code/i.test(c.name));
      await this.mutex.run(this.key(scope, `account:${identity.externalAccountId}`), () => this.mutex.run(this.key(scope, "catalog"), async () => {
        const catalog = await this.store.get<GatewayCredential[]>(scope, "catalog") ?? [];
        const previous = catalog.filter(c => c.externalAccountId === identity.externalAccountId);
        await this.store.put(scope, credentialReferenceId, { ...credential, cookies, updatedAt: new Date().toISOString() } satisfies StoredSession);
        await this.store.put(scope, "catalog", [...catalog.filter(c => c.externalAccountId !== identity.externalAccountId), credential]);
        for (const old of previous) await this.store.remove(scope, old.credentialReferenceId);
      }));
      this.flows.delete(flowId); await flow.close();
      return credential;
    });
  }
  async cancel(scope: GatewayUserScope, flowId: string): Promise<{ cancelled: true }> {
    return this.mutex.run(`flow:${flowId}`, async () => { const flow = this.flow(scope, flowId); this.flows.delete(flowId); await flow.close(); return { cancelled: true }; });
  }
  async accounts(scope: GatewayScope): Promise<GatewayCredential[]> { return await this.store.get<GatewayCredential[]>(scope, "catalog") ?? []; }
  private async session(input: AccountInput): Promise<StoredSession> {
    const session = await this.store.get<StoredSession>(input, input.credentialReferenceId);
    if (!session || session.status !== "active" || session.network !== input.network || input.externalAccountId && session.externalAccountId !== input.externalAccountId) throw new GatewayError("SESSION_INVALID");
    return session;
  }
  async resolve(input: AccountInput): Promise<{ valid: boolean }> { await this.session(input); return { valid: true }; }
  async disconnect(input: AccountInput): Promise<{ disconnected: true }> {
    const initial = await this.session(input);
    return this.mutex.run(this.key(input, `account:${initial.externalAccountId}`), async () => {
      await this.session(input);
      await this.store.remove(input, input.credentialReferenceId);
      await this.mutex.run(this.key(input, "catalog"), async () => {
        const catalog = await this.accounts(input);
        await this.store.put(input, "catalog", catalog.map(c => c.credentialReferenceId === input.credentialReferenceId ? { ...c, status: "revoked" } : c));
      });
      return { disconnected: true };
    });
  }
  private async withSession<T>(input: AccountInput, run: (driver: BrowserSocialDriver, session: StoredSession) => Promise<T>): Promise<T> {
    const initial = await this.session(input);
    return this.mutex.run(this.key(input, `account:${initial.externalAccountId}`), async () => {
      const session = await this.session(input);
      const lease = await this.pool.open(session.cookies);
      let timer: NodeJS.Timeout | undefined;
      let expired = false;
      let operation: Promise<T> | undefined;
      try {
        const page = await lease.context.newPage(); const driver = this.driver(input, page, lease.context);
        await driver.guardNetwork();
        const work = async () => {
          await driver.home();
          const identity = await driver.identity();
          if (identity.externalAccountId !== session.externalAccountId) throw new GatewayError("SESSION_INVALID");
          const result = await run(driver, session);
          if (expired) throw new GatewayError("TEMPORARY_PLATFORM_ERROR");
          await this.store.put(input, input.credentialReferenceId, { ...session, cookies: await lease.context.cookies(), updatedAt: new Date().toISOString() });
          return result;
        };
        operation = work();
        return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; void lease.close(); reject(new GatewayError("TEMPORARY_PLATFORM_ERROR")); }, this.options.operationTimeoutMs ?? 210_000); })]);
      } finally { clearTimeout(timer); await lease.close(); await operation?.catch(() => undefined); }
    });
  }
  async health(input: AccountInput): Promise<SocialHealthResult> {
    try { return await this.withSession(input, driver => driver.health()); }
    catch (error) {
      const code = error instanceof GatewayError && ["AUTH_REQUIRED", "SESSION_INVALID", "CHECKPOINT_REQUIRED", "NETWORK_ERROR"].includes(error.code) ? error.code as "AUTH_REQUIRED" | "SESSION_INVALID" | "CHECKPOINT_REQUIRED" | "NETWORK_ERROR" : "TEMPORARY_PLATFORM_ERROR";
      return { healthy: false, failure: { errorClass: code, code: `UNOFFICIAL_${code}` } };
    }
  }
  async publish(input: AccountInput & BrowserPublishInput & { idempotencyKey: string }): Promise<SocialPublishResult> {
    let dispatched = false;
    try { return await this.withSession(input, async (driver, session) => {
      const receiptId = `receipt:${session.externalAccountId}:${input.idempotencyKey}`;
      const existing = await this.store.get<Receipt>(input, receiptId);
      if (existing) return existing.result;
      // Failures before final dispatch are safe for the existing retry engine.
      await driver.prepare(input);
      const unknown: SocialPublishResult = { ok: "unknown", detail: "Envio iniciado; aguardando confirmação da rede.", providerReference: input.idempotencyKey };
      await this.store.put(input, receiptId, { externalAccountId: session.externalAccountId, result: unknown, createdAt: new Date().toISOString() } satisfies Receipt);
      dispatched = true;
      try {
        const result = await driver.submit(input.format);
        const final = result.ok === "unknown" ? { ...result, providerReference: input.idempotencyKey } : result;
        await this.store.put(input, receiptId, { externalAccountId: session.externalAccountId, result: final, createdAt: new Date().toISOString() } satisfies Receipt);
        return final;
      } catch { return unknown; }
    }); } catch (error) {
      if (dispatched) return { ok: "unknown", detail: "Aguardando confirmação da rede.", providerReference: input.idempotencyKey };
      if (error instanceof GatewayError) {
        const errorClass = error.code === "NOT_FOUND" ? "SESSION_INVALID" : error.code === "BUSY" ? "RATE_LIMITED" : error.code;
        return { ok: false, failure: { errorClass, code: `UNOFFICIAL_${error.code}` } };
      }
      return { ok: false, failure: { errorClass: "NETWORK_ERROR", code: "UNOFFICIAL_PRE_DISPATCH_ERROR" } };
    }
  }
  async acknowledge(input: AccountInput & { idempotencyKey: string; outcome: "published" | "not_published"; externalUrl?: string }): Promise<{ acknowledged: true }> {
    const session = await this.session(input);
    return this.mutex.run(this.key(input, `account:${session.externalAccountId}`), async () => {
      const id = `receipt:${session.externalAccountId}:${input.idempotencyKey}`;
      const receipt = await this.store.get<Receipt>(input, id);
      if (receipt?.result.ok === true && input.outcome === "not_published") throw new GatewayError("UNSUPPORTED");
      // Only the existing RBAC-protected, explicit user-confirmation path can clear uncertainty.
      if (input.outcome === "not_published") await this.store.remove(input, id);
      else await this.store.put(input, id, { externalAccountId: session.externalAccountId, createdAt: new Date().toISOString(), result: { ok: true, externalPostId: `confirmed-by-user:${input.idempotencyKey}`, externalUrl: input.externalUrl, publishedAt: new Date().toISOString() } } satisfies Receipt);
      return { acknowledged: true };
    });
  }
  async status(input: AccountInput & { providerReference?: string; externalPostId?: string }): Promise<SocialPublicationStatus> {
    const session = await this.session(input);
    if (input.providerReference) {
      const receipt = await this.store.get<Receipt>(input, `receipt:${session.externalAccountId}:${input.providerReference}`);
      if (receipt?.result.ok === true) return { kind: "published", ...receipt.result };
    }
    // No receipt / unknown receipt cannot prove absence on a network. Never trigger a blind retry.
    return { kind: "inconclusive", detail: "A publicação precisa ser conferida na rede antes de uma nova tentativa." };
  }
  async music(input: AccountInput & { query: string; format: BrowserPublishInput["format"]; limit: number }): Promise<SocialMusicTrack[]> {
    return this.withSession(input, async driver => { await driver.openComposer(input.format); return driver.music(input.query, input.limit); });
  }
  async shutdown(): Promise<void> { clearInterval(this.timer); for (const flow of this.flows.values()) await flow.close(); this.flows.clear(); await this.pool.shutdown(); }
}
