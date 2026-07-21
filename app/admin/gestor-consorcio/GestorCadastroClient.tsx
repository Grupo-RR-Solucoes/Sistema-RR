"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Card, Chip, EmptyState, HeaderNavy, Table, UiStyles } from "@/components/ui";

// FRENTE DE PRODUTO — M3 PARTE A2: define quem e o gestor de consorcio por competencia.
// O USUARIO gestor e criado em /admin/usuarios (perfil "Gestor de Consórcio"); aqui so
// se vincula a competencia. O grupo tem 1 gestor por competencia.

type Gestor = { id: string; nome: string; email: string; active: boolean };
type Vigencia = { competencia: string; app_user_id: string; nome: string; ativo: boolean };
type Payload = { gestores: Gestor[]; vigencias: Vigencia[] };

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function compLabel(iso: string) {
  const [y, m] = iso.split("-");
  return `${MES[Number(m) - 1] ?? m}/${y}`;
}

const CSS = `
.rrgest .wrap{max-width:920px;margin:0 auto;padding:24px 20px 64px;display:flex;flex-direction:column;gap:22px}
.rrgest .crumb{font-size:13px;color:var(--ink-3);display:flex;gap:8px;align-items:center}
.rrgest .crumb a{color:var(--ink-2);text-decoration:none}
.rrgest .crumb .sep{opacity:.5}
.rrgest .formrow{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;padding:4px 0 12px}
.rrgest .fld{display:flex;flex-direction:column;gap:4px}
.rrgest .fld label{font-size:12.5px;color:var(--ink-3)}
.rrgest .fld select,.rrgest .fld input{background:var(--paper);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;font:inherit;color:var(--ink);min-width:200px}
`;

export default function GestorCadastroClient() {
  const now = new Date();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [competencia, setCompetencia] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [appUserId, setAppUserId] = useState("");

  const load = useCallback((opts?: { silent?: boolean }) => {
    let cancel = false;
    if (!opts?.silent) setLoading(true);
    setError("");
    fetch("/api/admin/gestor-consorcio")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar."))))
      .then((j: Payload) => {
        if (!cancel) setData(j);
      })
      .catch((e) => {
        if (!cancel) setError(e.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const salvar = useCallback(async () => {
    setSaving(true);
    setError("");
    setOk("");
    try {
      const res = await fetch("/api/admin/gestor-consorcio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competencia, app_user_id: appUserId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Falha ao salvar.");
      }
      setOk(`Gestor definido para ${compLabel(competencia)}.`);
      load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }, [competencia, appUserId, load]);

  const gestores = data?.gestores ?? [];
  const vigencias = data?.vigencias ?? [];

  return (
    <div className="rrgest">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <Link href="/dashboard">Dashboard</Link>
          <span className="sep">/</span>
          <Link href="/admin/usuarios">Admin</Link>
          <span className="sep">/</span>
          <span>Gestor de Consórcio</span>
        </nav>

        <HeaderNavy
          brand="GRUPO RR CRED"
          title="Gestor de Consórcio"
          subtitle="Quem recebe os 10% de todo o consórcio. Um gestor por competência."
        />

        <Banner variant="info">
          O <b>usuário</b> gestor é criado em <Link href="/admin/usuarios">Admin › Usuários</Link> com o
          perfil <b>“Gestor de Consórcio”</b> (loga por e-mail). Aqui você define <b>quem</b> é o gestor
          vigente de cada competência — ele passa a ver a produção geral e o próprio repasse de 10%.
        </Banner>

        {error ? <Banner variant="warn">{error}</Banner> : null}
        {ok ? <Banner variant="ok">{ok}</Banner> : null}

        <Card title="Definir gestor da competência">
          {gestores.length === 0 ? (
            <EmptyState
              title="Nenhum usuário gestor de consórcio cadastrado."
              description="Crie primeiro o usuário em Admin › Usuários com o perfil “Gestor de Consórcio”."
              action={
                <Link href="/admin/usuarios">
                  <Button variant="primario">Ir para Usuários</Button>
                </Link>
              }
            />
          ) : (
            <div className="formrow">
              <div className="fld">
                <label>Competência</label>
                <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
              </div>
              <div className="fld">
                <label>Gestor</label>
                <select value={appUserId} onChange={(e) => setAppUserId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {gestores.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nome} ({g.email})
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="primario" onClick={salvar} disabled={saving || !appUserId}>
                {saving ? "Salvando…" : "Definir gestor"}
              </Button>
            </div>
          )}
        </Card>

        <Card title="Vigências">
          {loading ? (
            <p style={{ padding: 16, opacity: 0.7 }}>Carregando…</p>
          ) : vigencias.length === 0 ? (
            <EmptyState title="Nenhuma vigência definida ainda." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Gestor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vigencias.map((v) => (
                  <tr key={v.competencia}>
                    <td>{compLabel(v.competencia)}</td>
                    <td>{v.nome}</td>
                    <td>{v.ativo ? <Chip variant="ok">ativo</Chip> : <Chip variant="neutral">inativo</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </main>
    </div>
  );
}
