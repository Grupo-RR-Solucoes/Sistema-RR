type SectionCardProps = {
  title: string;
  description: string;
  children: React.ReactNode;
};

export default function SectionCard({
  title,
  description,
  children,
}: SectionCardProps) {
  return (
    <section className="section-card">
      <div className="section-card-header">
        <h2 className="section-card-title">{title}</h2>
        <p className="section-card-description">{description}</p>
      </div>
      {children}
    </section>
  );
}
