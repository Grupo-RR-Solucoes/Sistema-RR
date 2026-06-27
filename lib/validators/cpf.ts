// Validadores de CPF (pt-BR). Standalone, sem dependência de runtime — usável
// tanto no client (LoginForm) quanto em rota Node (resolve-cpf, admin/usuarios).

/** Remove tudo que não for dígito 0-9. */
export function onlyDigits(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

/**
 * Valida um CPF: 11 dígitos + dígitos verificadores corretos. Rejeita
 * sequências repetidas (000.000.000-00, 111…, etc.). Aceita entrada com ou
 * sem pontuação (normaliza internamente).
 */
export function isValidCPF(cpf: string): boolean {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return false;
  // Rejeita sequências de um único dígito (todas passam no algoritmo, mas são
  // inválidas por convenção: 00000000000, 11111111111, …).
  if (/^(\d)\1{10}$/.test(d)) return false;

  const dv = (base: string, pesoInicial: number): number => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * (pesoInicial - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const dig1 = dv(d.slice(0, 9), 10);
  if (dig1 !== Number(d[9])) return false;
  const dig2 = dv(d.slice(0, 10), 11);
  if (dig2 !== Number(d[10])) return false;
  return true;
}

/**
 * Formata para exibição "000.000.000-00". Aplica a máscara progressivamente
 * sobre o que houver de dígitos (não exige 11) — bom para máscara em tempo
 * real no input. Ignora não-dígitos da entrada.
 */
export function maskCPF(s: string): string {
  const d = onlyDigits(s).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
