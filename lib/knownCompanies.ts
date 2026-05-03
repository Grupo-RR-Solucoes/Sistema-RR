export type KnownCompanyIdentity = {
  empresaNome: string;
  empresaCnpj: string;
  mci: string;
  coban: string;
};

const KNOWN_COMPANIES: KnownCompanyIdentity[] = [
  {
    empresaNome: "RR SOLUCOES LTDA",
    empresaCnpj: "48357275000103",
    mci: "847822962",
    coban: "98250",
  },
  {
    empresaNome: "RR SOLUCOES AL LTDA",
    empresaCnpj: "56140658000153",
    mci: "873386662",
    coban: "18309",
  },
  {
    empresaNome: "RR AL SOLUCOES LTDA",
    empresaCnpj: "55867409000100",
    mci: "873298328",
    coban: "20466",
  },
  {
    empresaNome: "RR SOLUCOES PE LTDA",
    empresaCnpj: "51457289000103",
    mci: "850169280",
    coban: "14692",
  },
];

export const KNOWN_COMPANIES_BY_MCI = Object.fromEntries(
  KNOWN_COMPANIES.map((company) => [company.mci, company])
) as Record<string, KnownCompanyIdentity>;

export const KNOWN_COMPANIES_BY_COBAN = Object.fromEntries(
  KNOWN_COMPANIES.map((company) => [company.coban, company])
) as Record<string, KnownCompanyIdentity>;

export const KNOWN_COMPANIES_BY_CNPJ = Object.fromEntries(
  KNOWN_COMPANIES.map((company) => [company.empresaCnpj, company])
) as Record<string, KnownCompanyIdentity>;

function onlyNumbers(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function extractTempIdentifiers(reference: unknown) {
  const raw = String(reference ?? "").trim();

  if (!raw) {
    return { mci: "", coban: "" };
  }

  const tempMatch = raw.match(/TEMP-(\d+)-(\d+)/i);

  if (tempMatch) {
    return {
      mci: tempMatch[1],
      coban: tempMatch[2],
    };
  }

  const mciMatch = raw.match(/MCI\s+(\d+)/i);
  const cobanMatch = raw.match(/COBAN\s+(\d+)/i);

  return {
    mci: mciMatch?.[1] || "",
    coban: cobanMatch?.[1] || "",
  };
}

export function resolveKnownCompanyIdentity(params: {
  cnpj?: unknown;
  name?: unknown;
  mci?: unknown;
  coban?: unknown;
}) {
  const directCnpj = onlyNumbers(params.cnpj);
  const directMci = onlyNumbers(params.mci);
  const directCoban = onlyNumbers(params.coban);
  const fromCnpjReference = extractTempIdentifiers(params.cnpj);
  const fromNameReference = extractTempIdentifiers(params.name);

  if (directCnpj && KNOWN_COMPANIES_BY_CNPJ[directCnpj]) {
    return KNOWN_COMPANIES_BY_CNPJ[directCnpj];
  }

  const resolvedMci =
    directMci || fromCnpjReference.mci || fromNameReference.mci;
  if (resolvedMci && KNOWN_COMPANIES_BY_MCI[resolvedMci]) {
    return KNOWN_COMPANIES_BY_MCI[resolvedMci];
  }

  const resolvedCoban =
    directCoban || fromCnpjReference.coban || fromNameReference.coban;
  if (resolvedCoban && KNOWN_COMPANIES_BY_COBAN[resolvedCoban]) {
    return KNOWN_COMPANIES_BY_COBAN[resolvedCoban];
  }

  return null;
}

export function getCompanyDisplayIdentity(params: {
  cnpj?: unknown;
  name?: unknown;
  mci?: unknown;
  coban?: unknown;
}) {
  const known = resolveKnownCompanyIdentity(params);

  if (known) {
    return {
      empresaNome: known.empresaNome,
      empresaCnpj: known.empresaCnpj,
    };
  }

  const fallbackName = String(params.name ?? "").trim();
  const fallbackCnpj = String(params.cnpj ?? "").trim();

  return {
    empresaNome: fallbackName || fallbackCnpj || "Empresa sem nome",
    empresaCnpj: onlyNumbers(fallbackCnpj) || fallbackCnpj,
  };
}
