#!/usr/bin/env python3
"""
scripts/dia45_prepopulate_share_profiles.py

Dia 4.5 Etapa A — Pre-populacao da tabela promoter_share_profile com
a classificacao manual dos 44 promotores em 6 perfis distintos
(identificados a partir das planilhas mensais consolidadas RR AL_1,
AL_2, AL_3 e PE de abril/2026 + tabela ENTRANTES).

Uso:
  1. Aplique as duas migrations da Etapa A antes:
       supabase/migrations/20260518230000_dia45_share_profiles.sql
       supabase/migrations/20260518231000_dia45_share_scale_seeds.sql

  2. Configure as variaveis de ambiente (.env ja existente do
     projeto serve):
       NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
       SUPABASE_SERVICE_ROLE_KEY=eyJ...

  3. Instale supabase-py (so esta sessao):
       pip install supabase python-dotenv

  4. Rode:
       python scripts/dia45_prepopulate_share_profiles.py

Idempotencia: usa UPSERT (on_conflict promoter_id). Pode ser rodado
N vezes; cada execucao sincroniza o estado declarado em PROFILES
abaixo. Promotores nao listados em PROFILES viram DEFAULT.

Saida (stdout):
  - X promotores classificados explicitamente
  - Y promotores default automaticamente
  - Z nomes nao encontrados (Diego ajusta manualmente)
  - Distribuicao final por profile_type
"""

import os
import sys
import unicodedata
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    print(
        "[ERRO] dotenv nao instalado. Rode: pip install python-dotenv supabase",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    from supabase import create_client, Client
except ImportError:
    print(
        "[ERRO] supabase nao instalado. Rode: pip install supabase python-dotenv",
        file=sys.stderr,
    )
    sys.exit(1)


# ============================================================================
# DICIONARIO DE CLASSIFICACAO MANUAL DE PROMOTORES
#
# Cada entry e um tuple de 5 elementos:
#   (nome_banco, profile_type, fixed_percent, scale_code, notes)
#
# REGRAS:
# - profile_type DEFAULT:           NAO entrar aqui (catch-all aplica)
# - profile_type CLT_FIXO:          fixed_percent obrigatorio, scale_code=None
# - profile_type ACORDO_FIXO:       fixed_percent obrigatorio, scale_code=None
# - profile_type ENTRANTE_PADRAO:   fixed_percent=None, scale_code obrigatorio
# - profile_type ENTRANTE_CUSTOM:   fixed_percent=None, scale_code obrigatorio
# - profile_type ACORDO_VARIAVEL:   fixed_percent=None, scale_code=None
#                                   (override por proposta gerencia via UI)
#
# CHAVES MASTER:
#   As 4 chaves master (is_master=true) NAO devem ser classificadas aqui.
#   Caem em DEFAULT automaticamente. Recebem producao temporariamente
#   via fluxo MASTER_REASSIGNED do importador, e quando reatribuidas ao
#   promotor real, a cascata pega o profile do promotor real.
#
# D28 BACKLOG (promotores ausentes do banco mas presentes em abr/2026):
#   ANA CLARA, ANA PRISCILA, FABIANA BEZERRA, MONICA PEREIRA, MARIA LETICIA
#   Provavelmente ENTRANTE_PADRAO. Cadastrar primeiro, depois ajustar
#   profile via UI ou patch SQL.
#
# IDEMPOTENCIA: re-executar este script nao quebra. Faz UPSERT em todas
# as entries. Catch-all aplica DEFAULT em promoters novos nao listados.
# ============================================================================

PROFILES = [
    # --- CLT_FIXO (2)
    ("LILIAN CRISLAYNE TRINDADE NOBRE",          "CLT_FIXO",        0.1666, None,
     "CLT 16,66% (funcionaria registrada)"),
    ("MARIA DE FATIMA TAVARES DA COSTA",         "CLT_FIXO",        0.1666, None,
     "CLT 16,66% (funcionaria registrada)"),

    # --- ACORDO_FIXO (4)
    ("CARLA MIRELLE SILVA",                      "ACORDO_FIXO",     0.2500, None,
     "Acordo fixo comercial 25%"),
    ("ERIKA LILIAM SILVA DOS SANTOS NASCIMENTO", "ACORDO_FIXO",     0.6250, None,
     "Acordo fixo comercial 62,50%"),
    ("THAYNARA TAVARES CORREIA COSTA",           "ACORDO_FIXO",     0.7500, None,
     "Acordo fixo comercial 75%"),
    ("JULIANA DOS SANTOS OLIVEIRA",              "ACORDO_FIXO",     1.0000, None,
     "Acordo fixo comercial 100% (socia/empresa propria)"),

    # --- ENTRANTE_PADRAO (1) — usa scale PADRAO_ENTRANTE
    ("ISAC NICHOLAS AZEVEDO",                    "ENTRANTE_PADRAO", None,   "PADRAO_ENTRANTE",
     "Entrante padrao (escala 50k=43,85%; 80k=48,24%; 100k=52,63%; 136k=58,33%)"),

    # --- ENTRANTE_CUSTOM (1) — usa scale LETICIA_JAYENE
    ("LETICIA JAYENE MONTEIRO",                  "ENTRANTE_CUSTOM", None,   "LETICIA_JAYENE",
     "Entrante com escala personalizada (0 ate 100k = 0%, 100k+ = 25%)"),

    # --- ACORDO_VARIAVEL (4) — sem fixed, sem scale (override por proposta)
    ("ADRIANA MARIA DA SILVA DOS SANTOS",        "ACORDO_VARIAVEL", None,   None,
     "Acordo variavel por proposta (faixa 5,80% -> 66,66%)"),
    ("ALDALENE DE FREITAS ABRAAO",               "ACORDO_VARIAVEL", None,   None,
     "Acordo variavel por proposta (faixa 5,80% -> 61,20%; INSS novo+renovacao 3,34% -> 65,85%)"),
    ("JARLES MARLON DE OLIVEIRA",                "ACORDO_VARIAVEL", None,   None,
     "Acordo variavel por proposta (faixa 5,80% -> 62,50%)"),
    ("LUCIANA MATIAS DA SILVA",                  "ACORDO_VARIAVEL", None,   None,
     "Acordo variavel por proposta (faixa 5,80% -> 66,66%)"),
]


def normalize_name(value: str) -> str:
    """Remove acentos + uppercase + colapsa whitespace. Match robusto."""
    if value is None:
        return ""
    s = (
        unicodedata.normalize("NFD", str(value))
        .encode("ascii", "ignore")
        .decode("ascii")
        .upper()
        .strip()
    )
    return " ".join(s.split())


def load_env() -> tuple[str, str]:
    # Procura .env na raiz do projeto (parent do scripts/).
    project_root = Path(__file__).resolve().parent.parent
    env_file = project_root / ".env"
    if env_file.exists():
        load_dotenv(env_file)
    else:
        load_dotenv()  # fallback CWD

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get(
        "SUPABASE_URL"
    )
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "[ERRO] Variaveis NEXT_PUBLIC_SUPABASE_URL e "
            "SUPABASE_SERVICE_ROLE_KEY sao obrigatorias.",
            file=sys.stderr,
        )
        sys.exit(1)
    return url, key


def main() -> int:
    url, key = load_env()
    supabase: Client = create_client(url, key)

    # 1. Listar todos os promotores.
    print("Lendo promotores...")
    promoters_resp = supabase.table("promoters").select("id, name").execute()
    promoters = promoters_resp.data or []
    print(f"  {len(promoters)} promotores encontrados.")

    # 2. Index por nome normalizado.
    index: dict[str, list[dict]] = {}
    for p in promoters:
        key_name = normalize_name(p.get("name", ""))
        index.setdefault(key_name, []).append(p)

    # 3. Carregar mapa scale_code -> scale_id (para os perfis ENTRANTE).
    print("Lendo escalas (share_scale)...")
    scales_resp = supabase.table("share_scale").select("id, scale_code").execute()
    scale_id_by_code = {s["scale_code"]: s["id"] for s in (scales_resp.data or [])}
    print(f"  {len(scale_id_by_code)} escalas encontradas: "
          f"{sorted(scale_id_by_code.keys())}")

    # 4. Pre-populacao explicita.
    classified: list[tuple[str, str]] = []  # (promoter_name, profile_type)
    not_found: list[str] = []
    ambiguous: list[tuple[str, list[str]]] = []  # (search_name, matched_names)
    errors: list[tuple[str, str]] = []

    for search_name, profile_type, fixed_pct, scale_code, note in PROFILES:
        nk = normalize_name(search_name)
        matches = index.get(nk, [])
        # Match parcial: nome buscado eh prefixo do nome cadastrado?
        if not matches:
            matches = [
                p
                for k, lst in index.items()
                if nk in k or k in nk
                for p in lst
            ]

        if len(matches) == 0:
            not_found.append(search_name)
            continue
        if len(matches) > 1:
            ambiguous.append((search_name, [m["name"] for m in matches]))
            continue

        promoter = matches[0]
        row = {
            "promoter_id": promoter["id"],
            "profile_type": profile_type,
            "fixed_percent": float(fixed_pct) if fixed_pct is not None else None,
            "scale_id": (
                scale_id_by_code.get(scale_code) if scale_code else None
            ),
            "notes": note,
        }

        # Validar scale_id presente quando profile espera
        if profile_type in ("ENTRANTE_PADRAO", "ENTRANTE_CUSTOM") and not row[
            "scale_id"
        ]:
            errors.append(
                (search_name, f"scale_code {scale_code!r} nao encontrado em share_scale")
            )
            continue

        try:
            supabase.table("promoter_share_profile").upsert(
                row, on_conflict="promoter_id"
            ).execute()
            classified.append((promoter["name"], profile_type))
        except Exception as exc:  # noqa: BLE001
            errors.append((search_name, f"upsert falhou: {exc}"))

    # 5. Catch-all DEFAULT: todos os promotores sem profile ainda.
    existing_resp = (
        supabase.table("promoter_share_profile").select("promoter_id").execute()
    )
    existing_ids = {r["promoter_id"] for r in (existing_resp.data or [])}
    default_count = 0
    for p in promoters:
        if p["id"] in existing_ids:
            continue
        try:
            supabase.table("promoter_share_profile").insert(
                {
                    "promoter_id": p["id"],
                    "profile_type": "DEFAULT",
                    "fixed_percent": None,
                    "scale_id": None,
                }
            ).execute()
            default_count += 1
        except Exception as exc:  # noqa: BLE001
            errors.append((p["name"], f"insert default falhou: {exc}"))

    # 6. Resumo + distribuicao.
    print()
    print("=" * 60)
    print("RESUMO")
    print("=" * 60)
    print(f"Classificados explicitamente : {len(classified)}")
    print(f"Default catch-all aplicado   : {default_count}")
    if not_found:
        print(f"NAO ENCONTRADOS              : {len(not_found)}")
        for n in not_found:
            print(f"  - {n}")
    if ambiguous:
        print(f"AMBIGUOS (multiplos matches) : {len(ambiguous)}")
        for name, matches in ambiguous:
            print(f"  - {name} -> {matches}")
    if errors:
        print(f"ERROS                        : {len(errors)}")
        for name, msg in errors:
            print(f"  - {name}: {msg}")

    print()
    print("Distribuicao final por profile_type:")
    dist_resp = (
        supabase.table("promoter_share_profile")
        .select("profile_type")
        .execute()
    )
    counts: dict[str, int] = {}
    for r in dist_resp.data or []:
        counts[r["profile_type"]] = counts.get(r["profile_type"], 0) + 1
    for profile_type in sorted(counts.keys()):
        print(f"  {profile_type:18s} {counts[profile_type]}")
    print(f"  {'TOTAL':18s} {sum(counts.values())}")

    return 0 if not errors else 2


if __name__ == "__main__":
    sys.exit(main())
