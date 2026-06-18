import { UI_CSS } from "./uiCss";

/**
 * Injeta a CSS do kit (uma vez por página). Use no topo da página que adota os
 * primitivos — igual ao <style> que cada página já injeta hoje.
 */
export default function UiStyles() {
  return <style dangerouslySetInnerHTML={{ __html: UI_CSS }} />;
}
