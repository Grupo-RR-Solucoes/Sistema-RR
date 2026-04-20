import MetricCard from "@/components/ui/MetricCard";
import PageHeader from "@/components/ui/PageHeader";
import SectionCard from "@/components/ui/SectionCard";
import {
  dashboardPriorities,
  homeMetrics,
  nextSteps,
} from "@/lib/system-content";

export default function Home() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Dashboard Executivo"
        description="Base inicial do Sistema RR organizada para crescer com producao, fechamento, promotores, auditoria, despesas e fluxo de caixa sem depender de remendos operacionais."
      />

      <div className="grid-4">
        {homeMetrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
            highlight={metric.highlight}
          />
        ))}
      </div>

      <div className="grid-3">
        <SectionCard
          title="Prioridades desta fundacao"
          description="O foco agora e alinhar codigo, banco, imports e navegacao com as regras reais que voce definiu."
        >
          <ul className="section-list">
            {dashboardPriorities.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                {item.description}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Proximas conexoes"
          description="Esses blocos entram logo depois da fundacao visual e da documentacao tecnica."
        >
          <ul className="section-list">
            {nextSteps.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                {item.description}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Visao de produto"
          description="Tudo que voce mapeou ja esta organizado em modulos claros para o sistema nascer profissional."
        >
          <div className="section-grid">
            <span className="label-chip">Producao diaria e mensal</span>
            <span className="label-chip">Fechamento real por CNPJ</span>
            <span className="label-chip">PRT e diferido auditavel</span>
            <span className="label-chip">Promotores, metas e overrides</span>
            <span className="label-chip">Despesas e fluxo de caixa</span>
            <span className="label-chip">PDF e Excel para relatorios</span>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
