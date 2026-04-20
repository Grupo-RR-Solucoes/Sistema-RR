type PageHeaderProps = {
  title: string;
  description: string;
  actions?: React.ReactNode;
};

export default function PageHeader({
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-header-title">{title}</h1>
        <p className="page-header-description">{description}</p>
      </div>
      {actions ? <div className="button-row">{actions}</div> : null}
    </div>
  );
}
