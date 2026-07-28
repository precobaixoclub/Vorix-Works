import type {
  CapturedScreen,
  DiscoveredPage,
  Feature,
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeNode,
  MediaLibraryItem,
} from "../../../domain/company-intelligence/company-intelligence.model.js";
import { slugify } from "./slug.js";

/**
 * Construção do grafo de conhecimento (seção 8): liga Funcionalidades, Benefícios, Problemas,
 * Telas, Assets, Páginas, CTAs e Públicos num único grafo consultável pela Search API (seção 10).
 */

export type KnowledgeGraphInput = {
  features: Feature[];
  screens: CapturedScreen[];
  mediaLibrary: MediaLibraryItem[];
  pages: DiscoveredPage[];
  ctas: string[];
  targetAudience?: string;
};

export function buildKnowledgeGraph(input: KnowledgeGraphInput): KnowledgeGraph {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const seenNodeIds = new Set<string>();

  const addNode = (node: KnowledgeNode) => {
    if (seenNodeIds.has(node.id)) return;
    seenNodeIds.add(node.id);
    nodes.push(node);
  };

  for (const feature of input.features) {
    const featureNodeId = `feature:${feature.id}`;
    addNode({ id: featureNodeId, type: "feature", label: feature.name });

    if (feature.benefit) {
      const benefitNodeId = `benefit:${slugify(feature.benefit)}`;
      addNode({ id: benefitNodeId, type: "benefit", label: feature.benefit });
      edges.push({ from: featureNodeId, to: benefitNodeId, relation: "solves_with_benefit" });
    }
    if (feature.painPointSolved) {
      const problemNodeId = `problem:${slugify(feature.painPointSolved)}`;
      addNode({ id: problemNodeId, type: "problem", label: feature.painPointSolved });
      edges.push({ from: featureNodeId, to: problemNodeId, relation: "solves_problem" });
    }
    for (const screenId of feature.relatedScreenIds) {
      edges.push({ from: featureNodeId, to: `screen:${screenId}`, relation: "shown_on_screen" });
    }
  }

  for (const screen of input.screens) {
    addNode({ id: `screen:${screen.id}`, type: "screen", label: `${screen.category} (${screen.sourceUrl})` });
  }

  for (const item of input.mediaLibrary) {
    const assetNodeId = `asset:${item.id}`;
    addNode({ id: assetNodeId, type: "asset", label: item.description || item.category });
    for (const featureId of item.relatedFeatureIds) {
      edges.push({ from: assetNodeId, to: `feature:${featureId}`, relation: "illustrates_feature" });
    }
  }

  for (const page of input.pages) {
    const pageNodeId = `page:${page.path}`;
    addNode({ id: pageNodeId, type: "page", label: page.title || page.path });
    for (const feature of input.features) {
      const haystack = `${page.title ?? ""} ${page.path}`.toLowerCase();
      if (feature.keywords.some((keyword) => haystack.includes(keyword))) {
        edges.push({ from: pageNodeId, to: `feature:${feature.id}`, relation: "mentions_feature" });
      }
    }
  }

  const audienceNodeId = input.targetAudience ? `audience:${slugify(input.targetAudience)}` : undefined;
  if (audienceNodeId && input.targetAudience) {
    addNode({ id: audienceNodeId, type: "audience", label: input.targetAudience });
  }

  for (const cta of input.ctas) {
    const ctaNodeId = `cta:${slugify(cta)}`;
    addNode({ id: ctaNodeId, type: "cta", label: cta });
    if (audienceNodeId) edges.push({ from: ctaNodeId, to: audienceNodeId, relation: "targets" });
  }

  return { nodes, edges };
}
