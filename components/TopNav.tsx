"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import BrandLogo from "./BrandLogo";

// ============================================================================
// BARRA DO TOPO — navegacao principal.
//
// STICKY, nao fixed: com a sidebar fora do grid o documento voltou a ter fluxo
// unico, entao sticky basta e evita o padding-top compensatorio no body e o bug
// classico de ancora escondida sob barra fixa.
//
// CORES SO POR TOKEN: var(--navy), var(--accent), var(--gold),
// var(--nav-item-active). Nenhum hex literal aqui — se a barra hardcodasse cor
// ela ficaria com navy diferente do resto do sistema E a frente white-label
// (tema por grupo) nao conseguiria troca-la.
//
// FORA DE ESCOPO: busca global e icone de notificacao. Aparecem no mockup de
// referencia mas nao existem no sistema; nao foram inventados aqui.
// ============================================================================

// Icones Lucide (stroke 1.8) — vocabulario compartilhado com o drawer, que
// importa NavIcon daqui. AppShell importa TopNav, entao a direcao e unica e
// nao ha ciclo.
export const ICON_PATHS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/>',
  gauge: '<path d="m13 13 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  lock: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  trending: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  wallet: '<path d="M3 6a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2"/><path d="M3 6v12a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M21 11h-5a2 2 0 0 0 0 4h5a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1z"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  arrowdown: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  filechart: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/><path d="M8 18v-3"/><path d="M12 18v-6"/><path d="M16 18v-2"/>',
  usercog: '<circle cx="18" cy="15" r="3"/><circle cx="9" cy="7" r="4"/><path d="M10 15H6a4 4 0 0 0-4 4v2"/><path d="m21.7 16.4-.9-.3"/><path d="m15.2 13.9-.9-.3"/><path d="m16.6 18.7.3-.9"/><path d="m19.1 12.2.3-.9"/><path d="m19.6 18.7-.4-1"/><path d="m16.8 12.3-.4-1"/><path d="m14.3 16.6 1-.4"/><path d="m20.7 13.8 1-.4"/>',
  network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  linechart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
};

export function NavIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? "" }}
    />
  );
}

const MENU_PATH = '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>';
const LOGOUT_PATH =
  '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>';

function Glyph({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

export type TopNavItem = {
  href: string;
  label: string;
  icon: string;
};

export interface TopNavProps {
  /** Itens que aparecem na barra (ja filtrados por papel). */
  items: TopNavItem[];
  /**
   * Ha destino fora da barra? Se nao, o hamburguer some — mas SO enquanto a
   * barra esta expandida. Ver o comentario do colapso, abaixo.
   */
  showHamburger: boolean;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  isActive: (href: string) => boolean;
  userName: string | null;
  userRoleLabel: string | null;
  avatarInitial: string;
  /** Form de logout (post para /api/auth/logout) — montado pelo AppShell. */
  logoutAction: ReactNode;
}

/**
 * ESTADO DO ITEM — tres sinais INDEPENDENTES, para nao depender so de cor:
 *
 *   ATIVO  fundo var(--nav-item-active) + inset 0 -3px 0 var(--accent)
 *          + texto branco 600 + aria-current="page"
 *   HOVER  fundo rgba(255,255,255,.05) (metade da forca) + texto claro 500
 *   FOCO   outline var(--accent)
 *
 * REGRA SEMANTICA: amarelo = "onde eu estou". Branco/cinza = "onde eu poderia
 * ir". O hover NUNCA recebe o acento — por isso ativo e hover nunca se
 * confundem, nem de relance nem para quem nao distingue bem cor.
 */
export default function TopNav({
  items,
  showHamburger,
  drawerOpen,
  onToggleDrawer,
  isActive,
  userName,
  userRoleLabel,
  avatarInitial,
  logoutAction,
}: TopNavProps) {
  // COLAPSO (Fase 6) — quem decide e o CSS, nao o React.
  //
  // data-bar diz QUANTA barra ha para caber, e o globals.css tem um ponto de
  // quebra medido para cada caso. Nao ha estado de largura no React de
  // proposito: matchMedia/ResizeObserver dariam um primeiro render com a barra
  // errada (o servidor nao sabe a largura da janela) e um pulo visivel na
  // hidratacao. Media query nao pisca.
  //
  //   cheia  3+ itens  -> colapsa abaixo de 1300px
  //   curta  ate 2     -> colapsa abaixo de  700px
  //
  // Duas faixas porque a barra do promotor (2 itens, 598px) nao tem por que
  // virar hamburguer no mesmo ponto que a do funcionario (7 itens, 1276px).
  const barSize = items.length > 2 ? "cheia" : "curta";

  // O HAMBURGUER PASSA A SER OBRIGATORIO NO COLAPSO. Com a barra escondida,
  // papel sem hamburguer (promotor, supervisor, gestor de consorcio — todos com
  // showHamburger=false, porque hoje todos os destinos deles cabem na barra)
  // ficaria com ZERO navegacao na tela estreita. Entao o botao esta SEMPRE no
  // DOM e o CSS o esconde apenas quando ele e dispensavel E a barra esta
  // expandida. Acima do ponto de quebra o layout fica identico ao de hoje.
  const burgerMode = showHamburger ? "sempre" : "colapsada";

  return (
    <header className="rr-nav" data-bar={barSize} data-burger={burgerMode}>
      <button
        type="button"
        className="rr-nav__burger"
        onClick={onToggleDrawer}
        aria-label={drawerOpen ? "Fechar menu" : "Abrir menu"}
        aria-expanded={drawerOpen}
        title="Menu completo"
      >
        <Glyph d={MENU_PATH} />
      </button>

      {/* LOGO COMPACTO (marca isolada), NAO o lockup completo — medido.

          A arte full e 1177x696 (proporcao 1,69). A barra tem 56px de altura,
          entao o lockup caberia no maximo a ~44px de altura (74px de largura).
          Dentro da arte, "GRUPO RR" ocupa ~8,6% da altura e "CRED" ~12,9%:
          a 44px isso da 3,8px e 5,7px de altura de letra. Ilegivel — vira
          borrao, nao marca. Para "CRED" chegar aos 8px minimos de leitura a
          arte precisaria de 62px de altura, e "GRUPO RR" de 93px: mais que a
          barra inteira. Recortar a margem morta da arte (~15%) nao muda a
          conclusao.

          Nao e questao de pixelizar — 74x44 e um downscale de 16x, limpo. E
          tamanho de letra mesmo. Como a marca isolada ja renderiza a 41px de
          altura, o lockup na barra entregaria o MESMO simbolo mais um borrao
          ao lado, por 34px de largura a mais.

          O lockup completo continua no header do drawer (BrandLogo md, 150px),
          onde ha largura e altura para ele. Se o nome precisar aparecer na
          barra, o caminho e outro: marca + texto em HTML (nao a arte raster),
          decisao de design que reverte o "sem texto recriado em CSS" descrito
          no BrandLogo. */}
      <Link href="/" className="rr-nav__brand" aria-label="Inicio">
        <BrandLogo size="sm" tone="dark" />
      </Link>

      <nav className="rr-nav__nav" aria-label="Navegacao principal">
        <ul className="rr-nav__list">
          {items.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`rr-nav__item${active ? " active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="rr-nav__ic">
                    <NavIcon name={item.icon} />
                  </span>
                  <span className="rr-nav__lbl">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="rr-nav__user">
        {userName ? (
          <>
            <div className="rr-nav__avatar" aria-hidden="true">
              {avatarInitial}
            </div>
            <div className="rr-nav__uinfo">
              <span className="rr-nav__uname">{userName}</span>
              {userRoleLabel ? (
                <span className="rr-nav__urole">{userRoleLabel}</span>
              ) : null}
            </div>
            {logoutAction}
          </>
        ) : null}
      </div>
    </header>
  );
}

export { MENU_PATH, LOGOUT_PATH, Glyph };
