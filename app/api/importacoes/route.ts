import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { withMemoryCache } from "@/lib/memoryCache";

type DailyImportRow = {
  id: string;
  file_name: string;
  status?: string | null;
  rows_count?: number | null;
  created_at?: string | null;
  finished_at?: string | null;
  processing_notes?: string | null;
};

type MonthlyImportRow = {
  id: string;
  company_id?: string | null;
  year: number;
  month: number;
  file_name: string;
  status?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
};

type CompanyRow = {
  id: string;
  name: string;
  cnpj: string;
};

async function fetchAllRows<T>(queryFactory: () => any) {
  const pageSize = 1000;
  let from = 0;
  const rows: T[] = [];

  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const currentRows = (data || []) as T[];
    rows.push(...currentRows);

    if (currentRows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

export async function GET() {
  try {
    const payload = await withMemoryCache("route:importacoes", 20_000, async () => {
      const supabaseAdmin = getSupabaseAdmin();

      const [companies, dailyImports, monthlyImports] = await Promise.all([
        fetchAllRows<CompanyRow>(() =>
          supabaseAdmin.from("companies").select("id, name, cnpj").order("name", {
            ascending: true,
          })
        ),
        fetchAllRows<DailyImportRow>(() =>
          supabaseAdmin
            .from("daily_imports")
            .select("id, file_name, status, rows_count, created_at, finished_at, processing_notes")
            .order("created_at", { ascending: false })
        ),
        fetchAllRows<MonthlyImportRow>(() =>
          supabaseAdmin
            .from("monthly_closing_imports")
            .select("id, company_id, year, month, file_name, status, created_at, finished_at")
            .order("created_at", { ascending: false })
        ),
      ]);

      const companyById = new Map(companies.map((company) => [company.id, company]));

      return {
        summary: {
          dailyImports: dailyImports.length,
          monthlyClosingImports: monthlyImports.length,
          lastDailyImportAt: dailyImports[0]?.created_at || null,
          lastMonthlyClosingImportAt: monthlyImports[0]?.created_at || null,
        },
        companies,
        dailyImports: dailyImports.slice(0, 12),
        monthlyClosingImports: monthlyImports.slice(0, 12).map((row) => ({
          ...row,
          company_name: companyById.get(row.company_id || "")?.name || "Empresa nao identificada",
          company_cnpj: companyById.get(row.company_id || "")?.cnpj || "",
        })),
      };
    });

    return Response.json(payload);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao carregar importacoes." },
      { status: 500 }
    );
  }
}
