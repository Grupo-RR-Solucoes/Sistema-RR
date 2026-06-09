// Icones (lucide-style) compartilhados pela tela /admin/usuarios.
import type { SVGProps } from "react";

function S(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export const IcoUserCog = () => (
  <S width="13" height="13" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m19 8 2 2 2-2M21 6v6" /></S>
);
export const IcoUsers = () => (
  <S width="13" height="13" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></S>
);
export const IcoShield = () => (
  <S width="13" height="13" viewBox="0 0 24 24"><path d="m12 2 7 4v6c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-4Z" /></S>
);
export const IcoBriefcase = () => (
  <S width="13" height="13" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M6 21v-1a6 6 0 0 1 12 0v1" /></S>
);
export const IcoUser = () => (
  <S width="13" height="13" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></S>
);
export const IcoSearch = (p: SVGProps<SVGSVGElement>) => (
  <S width="16" height="16" viewBox="0 0 24 24" {...p}><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></S>
);
export const IcoPlus = () => (
  <S width="14" height="14" viewBox="0 0 24 24" strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></S>
);
export const IcoPencil = () => (
  <S width="14" height="14" viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></S>
);
export const IcoKey = () => (
  <S width="14" height="14" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.5 12.5 8-8M16 4h4v4" /></S>
);
export const IcoTrash = () => (
  <S width="14" height="14" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></S>
);
export const IcoBan = () => (
  <S width="12" height="12" viewBox="0 0 24 24" strokeWidth={2.2}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></S>
);
export const IcoUndo = () => (
  <S width="12" height="12" viewBox="0 0 24 24" strokeWidth={2.2}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></S>
);
export const IcoX = () => (
  <S width="14" height="14" viewBox="0 0 24 24" strokeWidth={2.2}><path d="M18 6 6 18M6 6l12 12" /></S>
);
export const IcoCopy = () => (
  <S width="13" height="13" viewBox="0 0 24 24" strokeWidth={2.2}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></S>
);
export const IcoCheck = () => (
  <S width="15" height="15" viewBox="0 0 24 24" strokeWidth={2.4}><path d="M20 6 9 17l-5-5" /></S>
);
export const IcoAlertTri = () => (
  <S width="14" height="14" viewBox="0 0 24 24" strokeWidth={2.2}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></S>
);
export const IcoInfo = () => (
  <S width="14" height="14" viewBox="0 0 24 24" strokeWidth={2.2}><circle cx="12" cy="12" r="9" /><path d="M12 16v-5M12 8h.01" /></S>
);
export const IcoSave = () => (
  <S width="14" height="14" viewBox="0 0 24 24" strokeWidth={2.2}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></S>
);
export const IcoLock = () => (
  <S width="13" height="13" viewBox="0 0 24 24" strokeWidth={2.2}><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></S>
);
export const IcoCheckSq = () => (
  <S width="13" height="13" viewBox="0 0 24 24" strokeWidth={2.2}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></S>
);
