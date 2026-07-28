import { join } from "node:path";
import type { CompanyKnowledgeRepositoryPort } from "../../application/company-intelligence/company-knowledge-repository.port.js";
import type {
  CapturedScreen,
  CompanyKnowledgeBase,
  ExtractedContent,
  MediaLibraryItem,
} from "../../domain/company-intelligence/company-intelligence.model.js";
import { readRasterDimensions } from "../visual-assets/visual-asset-metadata.js";
import { analyzeBrandLanguage } from "../../shared/utils/company-intelligence/brand-language-analysis.js";
import { buildCompanyProfile } from "../../shared/utils/company-intelligence/company-profile-builder.js";
import { discoverFeatures } from "../../shared/utils/company-intelligence/feature-discovery.js";
import { hashPageContent, diffDiscoveredPages, pagesNeedingRecollection } from "../../shared/utils/company-intelligence/incremental-update.js";
import { buildKnowledgeGraph } from "../../shared/utils/company-intelligence/knowledge-graph-builder.js";
import { buildQualityReport } from "../../shared/utils/company-intelligence/quality-report.js";
import { classifyScreen } from "../../shared/utils/company-intelligence/screen-classification.js";
import { extractContent } from "./content-extraction.js";
import { captureScreen } from "./screen-capture.js";
import { extractImages, extractVisualIdentity, mergeVisualIdentities } from "./visual-asset-extraction.js";
import { discoverWebsite, type WebsiteDiscoveryOptions } from "./website-discovery.js";

/**
 * Company Intelligence Engine (seções 2-9, 13, 14): orquestra descoberta → coleta → extração →
 * captura → análise → classificação → base de conhecimento, e persiste via a porta injetada.
 * Fica em `infrastructure/` (não em `application/`) porque sua responsabilidade central é I/O
 * (rede + disco) — a única dependência abstrata é a de persistência, exatamente como
 * `ClaraKnowledgeCenter` depende só de `ClaraKnowledgeRepositoryPort`.
 *
 * Aprendizado contínuo (seção 13): a cada chamada, busca a base anterior do mesmo domínio e só
 * refaz captura de tela + extração de imagens para páginas cujo conteúdo mudou (hash diferente) —
 * nunca reconstrói a base inteira "à toa". Páginas inalteradas reaproveitam o que já foi coletado.
 */

export type CompanyIntelligenceEngineDependencies = {
  repository: CompanyKnowledgeRepositoryPort;
  screenshotsDir: string;
};

export type CollectCompanyKnowledgeOptions = WebsiteDiscoveryOptions & {
  screenWidth?: number;
  screenHeight?: number;
};

export class CompanyIntelligenceEngine {
  private readonly repository: CompanyKnowledgeRepositoryPort;
  private readonly screenshotsDir: string;

  constructor(deps: CompanyIntelligenceEngineDependencies) {
    this.repository = deps.repository;
    this.screenshotsDir = deps.screenshotsDir;
  }

  async collect(domain: string, options: CollectCompanyKnowledgeOptions = {}): Promise<CompanyKnowledgeBase> {
    const previous = await this.repository.findByDomain(domain);
    const fetched = await discoverWebsite(domain, options);

    const nextPages = fetched.map((entry) => ({
      ...entry.page,
      contentHash: entry.html ? hashPageContent(entry.html) : entry.page.contentHash,
    }));

    const changeSet = previous ? diffDiscoveredPages(previous.pages, nextPages) : undefined;
    const pathsToRecollect = new Set(changeSet ? pagesNeedingRecollection(changeSet) : nextPages.map((page) => page.path));

    const contents: ExtractedContent[] = [];
    const screens: CapturedScreen[] = [];
    const mediaLibrary: MediaLibraryItem[] = [];
    const perPageVisualIdentities: Array<ReturnType<typeof extractVisualIdentity>> = [];

    for (const entry of fetched) {
      const path = entry.page.path;
      const reuse = previous && !pathsToRecollect.has(path);

      if (reuse) {
        const reusedContent = previous!.content.find((content) => content.pageUrl === entry.page.url);
        if (reusedContent) contents.push(reusedContent);
        const reusedScreens = previous!.screens.filter((screen) => screen.sourceUrl === entry.page.url);
        screens.push(...reusedScreens);
        const reusedMedia = previous!.mediaLibrary.filter((item) => item.origin === entry.page.url);
        mediaLibrary.push(...reusedMedia);
        continue;
      }

      if (!entry.html) continue;

      const content = extractContent(entry.html, entry.page.url);
      contents.push(content);

      const visualIdentity = extractVisualIdentity(entry.html, entry.page.url);
      perPageVisualIdentities.push(visualIdentity);

      for (const image of extractImages(entry.html, entry.page.url)) {
        mediaLibrary.push({
          id: `media-${hashPageContent(image.url).slice(0, 10)}`,
          category: image.likelyLogo ? "logo" : "image",
          description: image.alt || image.url,
          tags: image.likelyLogo ? ["logo"] : [],
          origin: entry.page.url,
          license: "unknown",
          sourceUrl: image.url,
          date: new Date().toISOString(),
          relatedFeatureIds: [],
        });
      }

      const screenshotPath = join(this.screenshotsDir, `${slugifyPath(path)}.png`);
      const capture = await captureScreen({
        url: entry.page.url,
        outputAbsolutePath: screenshotPath,
        width: options.screenWidth ?? 1280,
        height: options.screenHeight ?? 900,
      });

      if (capture.ok) {
        const dimensions = await readRasterDimensions(screenshotPath).catch(() => ({ width: options.screenWidth ?? 1280, height: options.screenHeight ?? 900 }));
        const screenId = `screen-${slugifyPath(path) || "home"}`;
        screens.push({
          id: screenId,
          sourceUrl: entry.page.url,
          category: classifyScreen(entry.page.url),
          absolutePath: screenshotPath,
          width: dimensions.width,
          height: dimensions.height,
          capturedAt: new Date().toISOString(),
        });
        mediaLibrary.push({
          id: `media-${screenId}`,
          category: "screen_capture",
          description: `Captura real de ${entry.page.url}`,
          tags: [classifyScreen(entry.page.url)],
          origin: entry.page.url,
          license: "third_party_public_page",
          absolutePath: screenshotPath,
          date: new Date().toISOString(),
          relatedFeatureIds: [],
        });
      }
    }

    const visualIdentity = mergeVisualIdentities(perPageVisualIdentities.length > 0 ? perPageVisualIdentities : previous ? [previous.profile.visualIdentity] : []);
    const brandLanguage = analyzeBrandLanguage(contents);
    const features = discoverFeatures(contents, screens);
    const homeTitle = fetched.find((entry) => entry.page.category === "home")?.page.title;

    const profile = buildCompanyProfile({ domain, homeTitle, content: contents, features, visualIdentity, brandLanguage });

    const graph = buildKnowledgeGraph({
      features,
      screens,
      mediaLibrary,
      pages: nextPages,
      ctas: brandLanguage.ctas,
      targetAudience: profile.targetAudience || undefined,
    });

    const baseWithoutReport: CompanyKnowledgeBase = {
      profile,
      pages: nextPages,
      content: contents,
      screens,
      mediaLibrary,
      features,
      brandLanguage,
      graph,
      qualityReport: {
        domain, generatedAt: new Date().toISOString(), pagesFound: 0, featuresIdentified: 0, ctasFound: 0,
        assetsCollected: 0, screensCaptured: 0, benefitsFound: 0, painPointsSolved: 0, brandScore: 0, coverageScore: 0, pendingItems: [],
      },
    };
    const qualityReport = buildQualityReport(baseWithoutReport);
    const base: CompanyKnowledgeBase = { ...baseWithoutReport, qualityReport };

    await this.repository.save(base);
    return base;
  }

  async get(domain: string): Promise<CompanyKnowledgeBase | undefined> {
    return this.repository.findByDomain(domain);
  }

  async list(): Promise<CompanyKnowledgeBase[]> {
    return this.repository.list();
  }
}

function slugifyPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "home";
}
