import { redirect } from "next/navigation";

import { getCurrentUser } from "../../lib/auth/getUser";
import LoginForm from "./LoginForm";
import { RRLOGIN_CSS } from "./loginStyles";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Se já logado (e ativo — getCurrentUser barra active=false), sai pra home.
  const session = await getCurrentUser();
  if (session) redirect("/");

  return (
    <div className="rrlogin">
      <style dangerouslySetInnerHTML={{ __html: RRLOGIN_CSS }} />
      <main className="stage">
        <LoginForm />
      </main>
    </div>
  );
}
