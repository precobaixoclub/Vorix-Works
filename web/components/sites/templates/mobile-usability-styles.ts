/**
 * Mobile usability floor for every built-in template (applied last, phones only).
 *
 * Templates keep their identity; this layer only guarantees what every storefront needs on a
 * phone: readable secondary text, touch targets close to 44px, form fields that do not make iOS
 * zoom on focus (font-size >= 16px) and section headings aligned with the content below them.
 * Imported templates bring their own CSS and are left untouched.
 */
const R = ".tenant-site:not(.tenant-site-imported)";

export const MOBILE_USABILITY_STYLES = String.raw`
@media(max-width:767px){
 /* iOS zooms into any focused field under 16px. */
 ${R} :is(input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea){font-size:16px!important}

 /* A desktop rule (align-items:end/flex-end) must not push stacked headings to the right. */
 ${R} .ts-section-heading{align-items:flex-start}
 ${R} .ts-align-center .ts-section-heading{align-items:center}

 /* Labels, eyebrows and meta text. */
 ${R} :is(.ts-eyebrow,.fk-kicker,.nexus-signal,.nexus-hero-bottom>span,.nexus-card-heading>span,.aura-edition,.aura-hero-index,.aura-card-index,.premium-product-category,.pulse-edition,.pulse-card-category,.ts-footer-column h3){font-size:11.5px}
 ${R} .ts-announcement{font-size:12px;line-height:1.5}
 ${R} :is(.ts-meta,.ts-form small,.ts-footer-bottom,.ts-catalog-toolbar>p,.ts-specs dt,.ts-specs dd,.ts-options label,.ts-form label,.ts-refine-grid label){font-size:13px}
 ${R} :is(.aura-bottom-note span,.aura-bottom-note a,.aura-image-note,.pulse-image-badge,.fk-photo-caption,.fk-text-link,.sp-card-offer,.sp-card-offer small){font-size:12px}
 ${R} .sp-color-choice-label{font-size:11.5px}
 ${R} .sp-counter{font-size:11px}
 ${R} :is(.ts-footer-brand p,.fk-details p,.fk-explore a,.pulse-quick-categories a){font-size:13px}
 ${R} :is(.ts-feature p,.fk-hero-copy>p,.fk-editorial-copy>p,.ts-detail-copy .ts-rich){font-size:14px}
 ${R} :is(.fk-hero-copy>p,.fk-editorial-copy>p){max-width:34em}
 ${R} :is(.fk-product h3,.fk-price){font-size:13px}
 ${R} .ts-button{font-size:14px;min-height:46px}

 /* Touch targets. */
 ${R} :is(.ts-icon-button,.premium-header-cta){min-width:44px;min-height:44px}
 ${R} .ts-refine summary{font-size:13px;min-height:44px;padding-block:12px;box-sizing:border-box}
 ${R} .sp-card-offer summary{min-height:40px}
 ${R} .ts-footer-column a{display:flex;align-items:center;min-height:40px;font-size:14px}
 ${R} .ts-breadcrumb{font-size:12px}
 ${R} .ts-breadcrumb a{display:inline-flex;align-items:center;min-height:36px}
 ${R} .fk-section-heading>.fk-text-link{min-height:44px}
 ${R} .fk-product .sp-arrow{width:34px;height:40px}
 ${R} .fk-hero-visual{padding-bottom:62px}
 ${R} .fk-photo-caption{min-height:44px;bottom:9px}
 ${R} .fk-mobile-nav a{font-size:14px}
 ${R} .fk-search>.fk-text-link{font-size:12px}
 /* Fashion header: room for two 40px icons beside the logo, down to 320px. */
 ${R} .fk-header-main{grid-template-columns:80px minmax(0,1fr) 80px}
 ${R} .fk-header-actions{width:80px}
 ${R} .fk-header-actions .fk-icon{width:40px;height:44px}
}
/* With 16px fields, two filters side by side truncate labels such as "Todas as categorias". */
@media(max-width:480px){${R} .ts-filters{grid-template-columns:minmax(0,1fr)}}
`;
