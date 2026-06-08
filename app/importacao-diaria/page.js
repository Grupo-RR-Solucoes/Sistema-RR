import { redirect } from "next/navigation";

// Tela aposentada. A importacao diaria virou a 2a aba "Diaria" dentro de
// /importacoes. Mantemos esta rota como redirect (pode haver bookmark salvo)
// abrindo direto a aba certa via ?tab=diaria.
export default function ImportacaoDiariaPage() {
  redirect("/importacoes?tab=diaria");
}
