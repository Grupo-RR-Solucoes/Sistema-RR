/**
 * @deprecated Use /api/admin/usuarios e /api/admin/usuarios/[id]
 * (Dia 4.1). Este endpoint duplica funcionalidade e sera
 * removido em fase futura. Mantido requireSocio aqui para
 * seguranca imediata enquanto cleanup nao acontece.
 */
import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { fetchAllRows } from "@/lib/queryHelpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type AccessProfileRow = {
  id: string;
  name: string;
  description?: string | null;
  created_at?: string | null;
};

type AppUserRow = {
  id: string;
  email: string;
  full_name?: string | null;
  access_profile_id?: string | null;
  active?: boolean | null;
  created_at?: string | null;
};

// audit_logs RLS bloqueia INSERT via PostgREST para todos os roles
// (Dia 3 grupo G). writeAudit usa service_role para escrever, idem
// pattern Dia 4.1 (/api/admin/usuarios). createdBy recebe o email do
// usuario autenticado vindo do guard (T5 do mapa de decisoes).
async function writeAudit(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    await supabaseAdmin.from("audit_logs").insert({
      entity_name: "configuracoes",
      action: "MANUAL_CHANGE",
      description,
      payload,
      created_by: createdBy,
    });
  } catch {
    // Mantem o fluxo principal.
  }
}

export async function GET() {
  try {
    const { supabase } = await withSocioAnon();

    const [profiles, users] = await Promise.all([
      fetchAllRows<AccessProfileRow>(() =>
        supabase
          .from("access_profiles")
          .select("id, name, description, created_at")
          .order("name", { ascending: true })
      ),
      fetchAllRows<AppUserRow>(() =>
        supabase
          .from("app_users")
          .select("id, email, full_name, access_profile_id, active, created_at")
          .order("created_at", { ascending: false })
      ),
    ]);

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    const payload = {
      summary: {
        profiles: profiles.length,
        users: users.length,
        activeUsers: users.filter((appUser) => appUser.active !== false).length,
        monthPolicy: "EDITAVEL",
        retroactivePolicy: "LIBERADA",
      },
      profiles,
      users: users.map((appUser) => ({
        ...appUser,
        profile_name: profileById.get(appUser.access_profile_id || "")?.name || "Sem perfil",
      })),
      governance: [
        {
          title: "Competencia",
          detail: "Mes aberto e editavel, sem travamento obrigatorio.",
        },
        {
          title: "Retroatividade",
          detail: "Lancamentos passados e futuros podem ser recalculados.",
        },
        {
          title: "Financeiro",
          detail: "Saldo inicial e categorias continuam sob controle manual.",
        },
        {
          title: "Acesso",
          detail:
            "Os cadastros de perfil e usuario ficam prontos agora. O bloqueio por login entra quando o Supabase Auth for conectado.",
        },
      ],
    };

    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioAnon();
    const auditActor = user.session.appUser.email;

    const body = await req.json();
    const action = String(body?.action || "").trim();

    if (action === "profile_upsert") {
      const id = body.id ? String(body.id) : null;
      const name = String(body.name || "").trim();
      const description = body.description ? String(body.description) : null;

      if (!name) {
        return NextResponse.json(
          { error: "Informe o nome do perfil." },
          { status: 400 }
        );
      }

      if (id) {
        const { error } = await supabase
          .from("access_profiles")
          .update({
            name,
            description,
          })
          .eq("id", id);

        if (error) throw error;

        await writeAudit(
          "Atualizacao manual de perfil de acesso",
          { profile_id: id, name },
          auditActor
        );

        return NextResponse.json({ success: true, updated: true });
      }

      const { data, error } = await supabase
        .from("access_profiles")
        .upsert(
          {
            name,
            description,
          },
          {
            onConflict: "name",
          }
        )
        .select("id")
        .single();

      if (error) throw error;

      await writeAudit(
        "Criacao ou reativacao de perfil de acesso",
        { profile_id: data.id, name },
        auditActor
      );

      return NextResponse.json({ success: true, updated: false, id: data.id });
    }

    if (action === "user_upsert") {
      const id = body.id ? String(body.id) : null;
      const email = String(body.email || "").trim().toLowerCase();
      const fullName = String(body.fullName || "").trim();
      const accessProfileId = body.accessProfileId ? String(body.accessProfileId) : null;

      if (!email) {
        return NextResponse.json(
          { error: "Informe o email do usuario." },
          { status: 400 }
        );
      }

      if (!accessProfileId) {
        return NextResponse.json(
          { error: "Selecione o perfil de acesso do usuario." },
          { status: 400 }
        );
      }

      if (id) {
        const { error } = await supabase
          .from("app_users")
          .update({
            email,
            full_name: fullName || null,
            access_profile_id: accessProfileId,
          })
          .eq("id", id);

        if (error) throw error;

        await writeAudit(
          "Atualizacao manual de usuario interno",
          { user_id: id, email, access_profile_id: accessProfileId },
          auditActor
        );

        return NextResponse.json({ success: true, updated: true });
      }

      const { data, error } = await supabase
        .from("app_users")
        .upsert(
          {
            email,
            full_name: fullName || null,
            access_profile_id: accessProfileId,
            active: true,
          },
          {
            onConflict: "email",
          }
        )
        .select("id")
        .single();

      if (error) throw error;

      await writeAudit(
        "Criacao ou reativacao de usuario interno",
        { user_id: data.id, email, access_profile_id: accessProfileId },
        auditActor
      );

      return NextResponse.json({ success: true, updated: false, id: data.id });
    }

    if (action === "toggle_user") {
      const id = String(body.id || "");
      const active = Boolean(body.active);

      if (!id) {
        return NextResponse.json(
          { error: "Informe o usuario que sera atualizado." },
          { status: 400 }
        );
      }

      const { error } = await supabase
        .from("app_users")
        .update({
          active,
        })
        .eq("id", id);

      if (error) throw error;

      await writeAudit(
        active ? "Reativacao de usuario" : "Inativacao de usuario",
        { user_id: id, active },
        auditActor
      );

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
