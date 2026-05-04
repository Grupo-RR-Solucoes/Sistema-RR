import { NextRequest, NextResponse } from "next/server";
import {
  auditCashEntriesForMonth,
  auditPrtForMonth,
} from "@/lib/historicalAuditEngine";

type CacheEntry = {
  data: { cash: any; prt: any };
  cachedAt: number;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

function cacheKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getCached(year: number, month: number): CacheEntry | null {
  const key = cacheKey(year, month);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCached(
  year: number,
  month: number,
  data: { cash: any; prt: any }
) {
  cache.set(cacheKey(year, month), { data, cachedAt: Date.now() });
}

function shouldSkipCache(req: NextRequest): boolean {
  return req.headers.get("x-skip-cache") === "true";
}

export async function GET(req: NextRequest) {
  const startMs = Date.now();
  const { searchParams } = new URL(req.url);
  const yearStr = searchParams.get("year");
  const monthStr = searchParams.get("month");

  if (!yearStr || !monthStr) {
    return NextResponse.json(
      { error: "Parâmetros year e month são obrigatórios" },
      { status: 400 }
    );
  }

  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);

  if (Number.isNaN(year) || Number.isNaN(month)) {
    return NextResponse.json(
      { error: "year e month devem ser números" },
      { status: 400 }
    );
  }

  if (month < 1 || month > 12) {
    return NextResponse.json(
      { error: "month deve estar entre 1 e 12" },
      { status: 400 }
    );
  }

  if (year < 2022 || year > 2030) {
    return NextResponse.json(
      { error: "year fora da faixa permitida (2022-2030)" },
      { status: 400 }
    );
  }

  if (!shouldSkipCache(req)) {
    const cached = getCached(year, month);
    if (cached) {
      return NextResponse.json({
        meta: {
          year,
          month,
          cached: true,
          cachedAt: new Date(cached.cachedAt).toISOString(),
          timing: { cashMs: 0, prtMs: 0, totalMs: Date.now() - startMs },
        },
        cash: cached.data.cash,
        prt: cached.data.prt,
      });
    }
  }

  try {
    const cashStart = Date.now();
    const prtStart = Date.now();

    const [cashResult, prtResult] = await Promise.all([
      auditCashEntriesForMonth(year, month),
      auditPrtForMonth(year, month),
    ]);

    const cashMs = Date.now() - cashStart;
    const prtMs = Date.now() - prtStart;

    setCached(year, month, { cash: cashResult, prt: prtResult });

    return NextResponse.json({
      meta: {
        year,
        month,
        cached: false,
        cachedAt: null,
        timing: { cashMs, prtMs, totalMs: Date.now() - startMs },
      },
      cash: cashResult,
      prt: prtResult,
    });
  } catch (err: any) {
    console.error("[/api/auditoria/historico] error:", err);
    return NextResponse.json(
      { error: err?.message || "Erro ao processar auditoria histórica" },
      { status: 500 }
    );
  }
}
