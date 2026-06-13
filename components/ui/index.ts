/**
 * RR UI Kit — primitivos do Sistema de Design RR (Etapa 2).
 * Import: `import { Card, KpiCard, Button, Table, Num, Chip, Banner, EmptyState, UiStyles } from "@/components/ui";`
 * Monte <UiStyles/> uma vez por página que adotar o kit (Etapa 3).
 */
export { default as UiStyles } from "./UiStyles";
export { UI_CSS } from "./uiCss";

export { default as Card } from "./Card";
export type { CardProps, CardVariant } from "./Card";

export { default as KpiCard } from "./KpiCard";
export type { KpiCardProps, KpiVariant } from "./KpiCard";

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
