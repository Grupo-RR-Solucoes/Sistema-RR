import fs from "node:fs/promises";
import path from "node:path";

const SEARCH_ROOTS = [
  "C:\\Users\\diego\\Downloads\\RRCRED\\Relatório de Produção",
  "C:\\Users\\diego\\Downloads",
];

const AUXILIARY_PATTERNS = [/CONSORCIO/i, /CONSÓRCIO/i, /BRASILCAP/i];
const COPY_PATTERNS = [/- COPIA/i, / - COPIA/i];
const NUMBERED_VARIANT_PATTERNS = [/\s\d+\.XLSX$/i];

const LEGACY_COMPANY_ALIASES = [
  {
    pattern: /^98250\s*-\s*RR SOLUCOES LTDA/i,
    cnpj: "48357275000103",
  },
];

const KNOWN_COMPANY_STARTS: Record<string, { year: number; month: number }> = {
  "48357275000103": { year: 2022, month: 12 },
};

export type HistoricalClosingCandidate = {
  fullPath: string;
  fileName: string;
  companyCnpj: string;
  year: number;
  month: number;
  sourceRoot: string;
  isAuxiliary: boolean;
  isCopy: boolean;
  lastWriteTime: string;
};

export type HistoricalClosingCoverageRow = {
  companyCnpj: string;
  period: string;
  fileName: string;
  fullPath: string;
};

function isStructuredCnpjFile(fileName: string) {
  return /^C\d+_\d{14}_TODOS_\d{1,2}_\d{4}\.XLSX$/i.test(normalizeText(fileName));
}

function isPrimaryReportFolder(fullPath: string) {
  return normalizeText(fullPath).includes(normalizeText("RRCRED\\Relatorio de Producao"));
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parsePeriod(fileName: string) {
  const text = normalizeText(fileName);

  let match = text.match(/_(\d{1,2})_(\d{4})/);
  if (match) {
    return {
      month: Number(match[1]),
      year: Number(match[2]),
    };
  }

  match = text.match(/ (\d{2})[.-](\d{4})/);
  if (match) {
    return {
      month: Number(match[1]),
      year: Number(match[2]),
    };
  }

  return null;
}

function inferCompanyCnpj(fileName: string) {
  const direct = fileName.match(/(\d{14})/);
  if (direct) {
    return direct[1];
  }

  for (const alias of LEGACY_COMPANY_ALIASES) {
    if (alias.pattern.test(fileName)) {
      return alias.cnpj;
    }
  }

  return null;
}

function shouldIgnoreAsAuxiliary(fileName: string) {
  return AUXILIARY_PATTERNS.some((pattern) => pattern.test(fileName));
}

function isCopyFile(fileName: string) {
  return COPY_PATTERNS.some((pattern) => pattern.test(fileName));
}

function isNumberedVariantFile(fileName: string) {
  return NUMBERED_VARIANT_PATTERNS.some((pattern) =>
    pattern.test(normalizeText(fileName))
  );
}

async function walkFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await walkFiles(fullPath)));
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  } catch {
    return [];
  }
}

function periodKey(year: number, month: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export async function scanHistoricalClosingCandidates() {
  const allFiles = (
    await Promise.all(SEARCH_ROOTS.map((root) => walkFiles(root)))
  ).flat();

  const candidates: HistoricalClosingCandidate[] = [];

  for (const fullPath of allFiles) {
    const fileName = path.basename(fullPath);

    if (!/\.xlsx$/i.test(fileName)) {
      continue;
    }

    const companyCnpj = inferCompanyCnpj(fileName);
    if (!companyCnpj) {
      continue;
    }

    const period = parsePeriod(fileName);
    if (!period || !period.month || !period.year) {
      continue;
    }

    const matchedRoot =
      SEARCH_ROOTS.find((root) => fullPath.startsWith(root)) || SEARCH_ROOTS[0];

    const stats = await fs.stat(fullPath);

    candidates.push({
      fullPath,
      fileName,
      companyCnpj,
      year: period.year,
      month: period.month,
      sourceRoot: matchedRoot,
      isAuxiliary: shouldIgnoreAsAuxiliary(fileName),
      isCopy: isCopyFile(fileName),
      lastWriteTime: stats.mtime.toISOString(),
    });
  }

  return candidates.sort((left, right) => {
    if (left.companyCnpj !== right.companyCnpj) {
      return left.companyCnpj.localeCompare(right.companyCnpj);
    }

    if (left.year !== right.year) {
      return left.year - right.year;
    }

    if (left.month !== right.month) {
      return left.month - right.month;
    }

    return left.fileName.localeCompare(right.fileName);
  });
}

function compareCandidates(
  left: HistoricalClosingCandidate,
  right: HistoricalClosingCandidate
) {
  if (left.isAuxiliary !== right.isAuxiliary) {
    return left.isAuxiliary ? 1 : -1;
  }

  if (left.isCopy !== right.isCopy) {
    return left.isCopy ? 1 : -1;
  }

  const leftNumberedVariant = isNumberedVariantFile(left.fileName);
  const rightNumberedVariant = isNumberedVariantFile(right.fileName);
  if (leftNumberedVariant !== rightNumberedVariant) {
    return leftNumberedVariant ? 1 : -1;
  }

  const leftStructured = isStructuredCnpjFile(left.fileName);
  const rightStructured = isStructuredCnpjFile(right.fileName);
  if (leftStructured !== rightStructured) {
    return leftStructured ? -1 : 1;
  }

  const leftPrimaryRoot = isPrimaryReportFolder(left.fullPath);
  const rightPrimaryRoot = isPrimaryReportFolder(right.fullPath);
  if (leftPrimaryRoot !== rightPrimaryRoot) {
    return leftPrimaryRoot ? -1 : 1;
  }

  if (left.lastWriteTime !== right.lastWriteTime) {
    return right.lastWriteTime.localeCompare(left.lastWriteTime);
  }

  return right.fileName.localeCompare(left.fileName);
}

export function groupHistoricalClosingCandidates(
  candidates: HistoricalClosingCandidate[]
) {
  const groups = new Map<string, HistoricalClosingCandidate[]>();

  for (const candidate of candidates) {
    if (candidate.isAuxiliary) {
      continue;
    }

    const key = `${candidate.companyCnpj}:${periodKey(candidate.year, candidate.month)}`;
    const bucket = groups.get(key) || [];
    bucket.push(candidate);
    groups.set(key, bucket);
  }

  return new Map(
    Array.from(groups.entries()).map(([key, bucket]) => [
      key,
      [...bucket].sort(compareCandidates),
    ])
  );
}

export function selectOfficialHistoricalClosingFiles(
  candidates: HistoricalClosingCandidate[]
) {
  return Array.from(groupHistoricalClosingCandidates(candidates).values())
    .map((bucket) => bucket.sort(compareCandidates)[0])
    .sort((left, right) => {
      if (left.companyCnpj !== right.companyCnpj) {
        return left.companyCnpj.localeCompare(right.companyCnpj);
      }

      if (left.year !== right.year) {
        return left.year - right.year;
      }

      return left.month - right.month;
    });
}

export function buildHistoricalClosingCoverage(
  officialFiles: HistoricalClosingCandidate[]
) {
  const byCompany = new Map<string, HistoricalClosingCandidate[]>();

  for (const file of officialFiles) {
    const bucket = byCompany.get(file.companyCnpj) || [];
    bucket.push(file);
    byCompany.set(file.companyCnpj, bucket);
  }

  const rows: Record<
    string,
    {
      companyCnpj: string;
      firstPeriod: string | null;
      lastPeriod: string | null;
      filesCount: number;
      missingPeriods: string[];
      officialFiles: HistoricalClosingCoverageRow[];
    }
  > = {};

  for (const [companyCnpj, files] of byCompany.entries()) {
    const sorted = [...files].sort((left, right) => {
      if (left.year !== right.year) {
        return left.year - right.year;
      }

      return left.month - right.month;
    });

    const firstKnown = KNOWN_COMPANY_STARTS[companyCnpj] || {
      year: sorted[0]?.year || 0,
      month: sorted[0]?.month || 0,
    };
    const firstPeriod = periodKey(firstKnown.year, firstKnown.month);
    const lastFile = sorted[sorted.length - 1];
    const lastPeriod = lastFile ? periodKey(lastFile.year, lastFile.month) : null;

    const existingKeys = new Set(
      sorted.map((file) => periodKey(file.year, file.month))
    );
    const missingPeriods: string[] = [];

    if (lastFile) {
      let year = firstKnown.year;
      let month = firstKnown.month;

      while (year < lastFile.year || (year === lastFile.year && month <= lastFile.month)) {
        const key = periodKey(year, month);
        if (!existingKeys.has(key)) {
          missingPeriods.push(key);
        }

        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }

    rows[companyCnpj] = {
      companyCnpj,
      firstPeriod,
      lastPeriod,
      filesCount: sorted.length,
      missingPeriods,
      officialFiles: sorted.map((file) => ({
        companyCnpj: file.companyCnpj,
        period: periodKey(file.year, file.month),
        fileName: file.fileName,
        fullPath: file.fullPath,
      })),
    };
  }

  return rows;
}
