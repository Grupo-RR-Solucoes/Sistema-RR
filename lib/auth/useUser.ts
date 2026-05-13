"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "./supabaseBrowserClient";
import type { AppUserWithRole, UserRole } from "./types";

type UseUserState = {
  user: AppUserWithRole | null;
  loading: boolean;
  error: string | null;
};

/**
 * Hook client-side que retorna o usuário logado.
 *
 * Faz duas chamadas:
 *   1. supabase.auth.getUser() — pega o auth user via cookie
 *   2. SELECT em app_users via auth_user_id — pega role/cnpj/promoter
 *
 * Inscreve em onAuthStateChange para reagir a login/logout em tempo real
 * (ex.: outro tab fez logout, esta sessão também precisa atualizar).
 */
export function useUser(): UseUserState {
  const [state, setState] = useState<UseUserState>({
    user: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    async function load() {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (authError || !authUser) {
        setState({ user: null, loading: false, error: null });
        return;
      }

      const { data: row, error: rowError } = await supabase
        .from("app_users")
        .select("id, email, full_name, role, cnpj_id, promoter_id, active")
        .eq("auth_user_id", authUser.id)
        .single();

      if (cancelled) return;

      if (rowError || !row || !row.active) {
        setState({
          user: null,
          loading: false,
          error: rowError?.message ?? "Usuário não provisionado",
        });
        return;
      }

      setState({
        user: {
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          role: row.role as UserRole,
          cnpjId: row.cnpj_id,
          promoterId: row.promoter_id,
          active: row.active,
        },
        loading: false,
        error: null,
      });
    }

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      load();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
