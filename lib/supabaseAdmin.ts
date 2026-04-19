import { createClient } from "@supabase/supabase-js";

/**
 * 🔐 ADMIN (SERVER ONLY)
 * usa SERVICE ROLE → acesso total ao banco
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Variáveis do Supabase não configuradas");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
  },
});
