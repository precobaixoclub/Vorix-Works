import type React from "react";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import {
  AI_PROMPT, ALLOWED_ATTRIBUTES_TEXT, ALLOWED_TAGS_TEXT, CSS_VARIABLES, FEATURES_EXAMPLE, FIELD_DOCS, HERO_EXAMPLE, ISSUE_DOCS, MANIFEST_EXAMPLE, NATIVE_SECTION_DOCS,
  PACKAGE_LIMITS, STRUCTURE_EXAMPLE, TEMPLATED_SECTION_DOCS, THEME_EXAMPLE,
} from "@/features/sites/template-package-docs";

export const metadata = {
  title: "Importar modelo de site | Vorix",
  description: "Como preparar um modelo de site criado fora do Vorix (Pacote de Modelo Vorix) para importar e editar no Vorix Site.",
};

const TOC = [
  ["como-funciona", "Como funciona"],
  ["estrutura", "Estrutura do pacote"],
  ["manifest", "manifest.json"],
  ["tema", "theme.json"],
  ["secoes", "Seções e campos editáveis"],
  ["vorix", "Seções montadas pelo Vorix"],
  ["css", "styles.css"],
  ["imagens", "Imagens"],
  ["regras", "O que não é permitido"],
  ["limites", "Limites"],
  ["converter", "Converter um template pronto"],
  ["erros", "Mensagens de validação"],
] as const;

export default function TemplateImportDocsPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <PublicHeader />
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="Nesta página" className="hidden lg:block">
          <div className="sticky top-24 space-y-1 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nesta página</p>
            {TOC.map(([id, label]) => <a key={id} href={`#${id}`} className="block rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">{label}</a>)}
          </div>
        </nav>
        <article className="min-w-0 space-y-12 text-sm leading-6 text-muted-foreground">
          <header className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Vorix Site · Documentação</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Pacote de Modelo Vorix</h1>
            <p className="max-w-2xl text-base">Tudo o que um modelo de site criado fora do Vorix precisa para ser importado. O pacote é conferido antes: se algo não estiver de acordo, a importação é bloqueada e cada problema aparece com o arquivo, a linha e como corrigir.</p>
            <div className="flex flex-wrap gap-2">
              <a href="/site-assets/vorix-modelo-exemplo.zip" download className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Baixar pacote de exemplo</a>
              <a href="#converter" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted">Converter um template pronto</a>
            </div>
          </header>

          <Section id="como-funciona" title="Como funciona">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Monte o pacote (.zip) seguindo esta página — ou parta do <a className="font-medium text-primary underline" href="/site-assets/vorix-modelo-exemplo.zip" download>pacote de exemplo</a>.</li>
              <li>No Vorix, abra <strong className="text-foreground">Site → Editor do site → Modelos → Importar modelo externo</strong>, escolha o .zip e clique em <strong className="text-foreground">Só validar</strong> para ver o relatório sem importar nada.</li>
              <li>Com o relatório limpo, clique em <strong className="text-foreground">Validar e importar</strong>. Avisos não bloqueiam; erros sim.</li>
              <li>Em <strong className="text-foreground">Usar este modelo</strong>, escolha trazer o conteúdo do pacote ou aplicar só a aparência ao seu conteúdo atual.</li>
              <li>Edite tudo no Vorix (textos, imagens, botões, itens, cores, menu, rodapé) e publique quando estiver pronto.</li>
            </ol>
            <Note>O pacote define a <strong>aparência</strong> e o <strong>conteúdo inicial</strong>. Cabeçalho, rodapé, carrinho, busca, catálogo, páginas de produto, formulário e checkout continuam sendo do Vorix — por isso funcionam e são editáveis como em qualquer modelo.</Note>
          </Section>

          <Section id="estrutura" title="Estrutura do pacote">
            <Code>{STRUCTURE_EXAMPLE}</Code>
            <p>Os arquivos podem estar na raiz do .zip ou dentro de uma única pasta. README e LICENSE são aceitos e ignorados.</p>
          </Section>

          <Section id="manifest" title="manifest.json (obrigatório)">
            <Code>{MANIFEST_EXAMPLE}</Code>
            <Table head={["Campo", "Obrigatório", "Descrição"]} rows={[
              ["format / formatVersion", "sim", "Sempre \"vorix-site-template\" e 1."],
              ["name / version", "sim", "Nome (até 80 caracteres) e versão do modelo."],
              ["author / description", "não", "Aparecem na lista de modelos importados."],
              ["preview / theme / styles", "não", "Caminhos dos arquivos. Padrão: preview.png, theme.json e styles.css."],
              ["navigation", "não", "Até 8 links do menu: { label, url }."],
              ["home", "sim", "Seções da página inicial, na ordem: { type, file } ou, nas seções do Vorix, { type, title, text }."],
              ["pages", "não", "Até 10 páginas: { slug, title, sections }. Uma seção pode trocar o título com \"title\"."],
            ]} />
          </Section>

          <Section id="tema" title="theme.json">
            <Code>{THEME_EXAMPLE}</Code>
            <Table head={["Campo", "Valores"]} rows={[
              ["primary, secondary, background, foreground, surface, headerBackground, footerBackground, footerForeground", "Cor em #RRGGBB"],
              ["bodyFont, headingFont", "modern, classic, rounded ou editorial"],
              ["buttonStyle", "rounded, pill ou square"],
              ["rounded", "true ou false (cantos arredondados)"],
              ["contentWidth / sectionSpacing / fontSize / headerLayout", "standard·wide / compact·comfortable·spacious / normal·large / split·center·compact"],
            ]} />
            <p>Depois de importar, tudo isso pode ser ajustado em <strong className="text-foreground">Cores, fontes e composição</strong>.</p>
          </Section>

          <Section id="secoes" title="Seções e campos editáveis">
            <p>Cada arquivo em <code>sections/</code> tem <strong className="text-foreground">uma única</strong> <code>&lt;section data-vorix-block=&quot;tipo&quot;&gt;</code>. Marque o que a pessoa vai editar no Vorix com <code>data-vorix-field</code>. O texto escrito no HTML vira o conteúdo inicial.</p>
            <Code>{HERO_EXAMPLE}</Code>
            <p>Seções com lista (diferenciais, números, depoimentos, logos, perguntas) usam <code>data-vorix-repeat=&quot;items&quot;</code>. O primeiro item define o desenho de todos; os itens do HTML viram o conteúdo inicial.</p>
            <Code>{FEATURES_EXAMPLE}</Code>
            <Table head={["Tipo", "Seção", "Campos (obrigatórios em negrito)", "Campos de cada item"]} rows={TEMPLATED_SECTION_DOCS.map((section) => [
              <code key="t">{section.type}</code>, section.label,
              <Fields key="f" fields={section.fields} required={section.required} />,
              section.items ? <Fields key="i" fields={section.items.fields} required={section.items.required} /> : "—",
            ])} />
            <Table head={["Campo", "Significado", "Tags aceitas"]} rows={FIELD_DOCS.map(([field, label, tags]) => [<code key="c">{field}</code>, label, tags])} />
            <Note>Um elemento marcado como campo de texto deve conter <strong>só texto</strong>. Campos opcionais vazios somem do site, como nas seções do Vorix.</Note>
          </Section>

          <Section id="vorix" title="Seções montadas pelo Vorix">
            <p>Estas seções dependem de dados do Vorix (produtos, formulário, vídeo) e <strong className="text-foreground">não aceitam HTML próprio</strong>: entram no manifest só com o tipo e os textos. Para mudar a aparência, use o styles.css com as classes abaixo.</p>
            <Table head={["Tipo", "Seção", "No manifest", "Classes para estilizar"]} rows={NATIVE_SECTION_DOCS.map((section) => [<code key="t">{section.type}</code>, section.label, section.manifest, <code key="c" className="break-words">{section.classes}</code>])} />
            <p>Cabeçalho e rodapé também podem ser ajustados: <code>.ts-header</code>, <code>.ts-nav</code>, <code>.ts-brand</code>, <code>.ts-footer</code>.</p>
          </Section>

          <Section id="css" title="styles.css">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Todo seletor é restrito ao site automaticamente (prefixo <code>.tenant-site-imported</code>); <code>html</code>, <code>body</code> e <code>:root</code> passam a valer para a raiz do site.</li>
              <li>Permitidos: <code>@media</code>, <code>@supports</code>, <code>@container</code> e <code>@keyframes</code>.</li>
              <li>Imagens de fundo: <code>url(assets/arquivo.jpg)</code>, sempre de dentro do pacote.</li>
              <li>Inclua ajustes para celular com <code>@media (max-width: 700px)</code>.</li>
              <li>Use as variáveis do tema para as cores mudarem junto com o painel: {CSS_VARIABLES.map((name, index) => <span key={name}>{index ? ", " : ""}<code>var({name})</code></span>)}.</li>
            </ul>
          </Section>

          <Section id="imagens" title="Imagens">
            <p>Coloque em <code>assets/</code> e referencie por caminho relativo (<code>assets/banner.jpg</code>). Aceitos: JPG, PNG e WEBP, até 5 MB. Na importação, as imagens são otimizadas para WEBP (até 2400 px) e ficam no armazenamento do seu site. SVG e GIF não são aceitos — exporte como PNG ou WEBP.</p>
          </Section>

          <Section id="regras" title="O que não é permitido (e por quê)">
            <Table head={["Não permitido", "Motivo", "Alternativa"]} rows={[
              ["<script>, onclick, onload, javascript:", "Scripts de terceiros podem roubar dados dos seus clientes.", "Carrinho, formulário, WhatsApp e busca são do Vorix."],
              ["<iframe>, <video>, <form>, <input>, <button>", "Conteúdo externo e formulários sem proteção.", "Seções “video” e “contact”; botões com <a data-vorix-field=\"button\">."],
              ["style=\"…\", <style>, <link>", "Estilos soltos quebram a edição e o restante do site.", "Classes no styles.css."],
              ["@import, @font-face, url(https://…)", "Arquivos externos podem sumir ou rastrear visitantes.", "Tudo dentro do pacote; fontes pelo theme.json."],
              ["<svg>, imagens SVG e GIF", "SVG pode conter scripts.", "PNG ou WEBP."],
            ]} />
            <p>Tags aceitas: {ALLOWED_TAGS_TEXT}.</p>
            <p>Atributos aceitos: {ALLOWED_ATTRIBUTES_TEXT}. Atributos <code>id</code> e <code>data-*</code> de bibliotecas são removidos com aviso.</p>
          </Section>

          <Section id="limites" title="Limites">
            <Table head={["Item", "Limite"]} rows={PACKAGE_LIMITS.map(([item, limit]) => [item, limit])} />
          </Section>

          <Section id="converter" title="Converter um template pronto (HTML, tema comprado, outro construtor)">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Separe a página em seções (banner, diferenciais, sobre, depoimentos…) e escolha o tipo do Vorix mais próximo de cada uma.</li>
              <li>Copie o HTML de cada seção para <code>sections/</code>, marque os campos e remova scripts, iframes e formulários.</li>
              <li>Troque a grade de produtos, o formulário e o vídeo pelas seções do Vorix no manifest.</li>
              <li>Junte o CSS usado em <code>styles.css</code> e copie as imagens para <code>assets/</code>.</li>
              <li>Valide no Vorix com “Só validar” e corrija o que o relatório apontar.</li>
            </ol>
            <p>Se usar uma IA para converter, este pedido costuma funcionar bem:</p>
            <Code>{AI_PROMPT}</Code>
          </Section>

          <Section id="erros" title="Mensagens de validação">
            <p>Erros bloqueiam a importação; avisos só alertam. O relatório mostra o código, o arquivo, a linha e como corrigir.</p>
            <Table head={["Código", "Tipo", "O que significa", "Como corrigir"]} rows={Object.entries(ISSUE_DOCS).map(([code, doc]) => [<code key="c" className="break-all text-xs">{code}</code>, doc.severity, doc.title, doc.fix])} />
          </Section>
        </article>
      </div>
      <PublicFooter />
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-24 space-y-4"><h2 className="text-xl font-semibold text-foreground">{title}</h2>{children}</section>;
}
function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 text-xs leading-5 text-foreground"><code>{children}</code></pre>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-foreground">{children}</p>;
}
function Fields({ fields, required }: { fields: string[]; required: string[] }) {
  if (!fields.length) return <>—</>;
  return <>{fields.map((field, index) => <span key={field}>{index ? ", " : ""}{required.includes(field) ? <strong className="text-foreground">{field}</strong> : field}</span>)}</>;
}
function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="bg-muted/40 text-foreground"><tr>{head.map((cell) => <th key={cell} className="px-3 py-2 font-semibold">{cell}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-border align-top">{row.map((cell, column) => <td key={column} className="px-3 py-2">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
