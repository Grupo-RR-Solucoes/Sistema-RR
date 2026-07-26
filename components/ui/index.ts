/**
 * RR UI Kit — primitivos do Sistema de Design RR.
 * Import: `import { HeaderNavy, KpiBand, KpiHero, Card, Button, Table, Num, Chip, Banner, EmptyState, UiStyles } from "@/components/ui";`
 * Monte <UiStyles/> uma vez por página que adotar o kit.
 */
export { default as UiStyles } from "./UiStyles";
export { UI_CSS } from "./uiCss";

export { default as HeaderNavy } from "./HeaderNavy";
export type { HeaderNavyProps } from "./HeaderNavy";

export { default as KpiBand } from "./KpiBand";
export type { KpiBandProps, KpiStat, KpiSubTone } from "./KpiBand";

export { default as DeltaBadge } from "./DeltaBadge";
export type { DeltaBadgeProps } from "./DeltaBadge";

export { default as KpiHero } from "./KpiHero";
export type { KpiHeroProps, KpiHeroMeter, KpiHeroSecondary, KpiHeroTone, Semaforo } from "./KpiHero";

export { default as Card } from "./Card";
export type { CardProps, CardVariant } from "./Card";

export { default as Button } from "./Button";
export type { ButtonProps, ButtonVariant } from "./Button";

export { Table, Num } from "./Table";
export type { TableProps } from "./Table";

export { default as Chip } from "./Chip";
export type { ChipProps, ChipVariant } from "./Chip";

export { default as Banner } from "./Banner";
export type { BannerProps, BannerVariant } from "./Banner";

export { default as EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
