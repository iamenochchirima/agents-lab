import { ArrowLeft, ArrowRight, CircleDashed } from "lucide-react";
import { Link, useParams } from "react-router";

import { appPaths } from "../../routes/paths";
import { AvailabilityBadge } from "../platforms/AvailabilityBadge";
import { platformCatalog } from "../platforms/platformCatalog";
import { environmentCatalog, getEnvironment } from "./environmentCatalog";
import "../platforms/platforms.css";

export function EnvironmentsPage() {
  return (
    <div className="page-content environment-page">
      <header className="page-heading"><div><span className="eyebrow">Computer Native</span><h1>Computer environments</h1><p>These profiles describe the computer, limits, and lifecycle around a Computer Native run.</p></div></header>
      <div className="environment-card-grid">
        {environmentCatalog.map((environment) => (
          <article className="panel environment-card" key={environment.id}>
            <div className="environment-card-heading"><div><span className="environment-type">Environment profile</span><h2>{environment.name}</h2></div><AvailabilityBadge status={environment.status} /></div>
            <p>{environment.description}</p>
            <dl className="compact-definition-list"><div><dt>Isolation</dt><dd>{environment.isolation}</dd></div><div><dt>Workspace</dt><dd>{environment.workspace}</dd></div><div><dt>Lifecycle</dt><dd>{environment.lifecycle}</dd></div></dl>
            <Link className="text-button" to={appPaths.environment(environment.id)}>View profile <ArrowRight aria-hidden="true" size={15} /></Link>
          </article>
        ))}
      </div>
    </div>
  );
}

export function EnvironmentDetailPage() {
  const { environmentId } = useParams();
  const environment = getEnvironment(environmentId);

  if (!environment) {
    return <div className="page-content"><section className="panel empty-state"><h1>Environment not found</h1><p>The selected environment is not registered in the laboratory.</p><Link className="text-button" to={appPaths.environments}>View environments <ArrowRight aria-hidden="true" size={15} /></Link></section></div>;
  }

  const compatiblePlatforms = platformCatalog.filter((platform) => environment.compatiblePlatformIds.includes(platform.id));

  return (
    <div className="page-content environment-detail-page">
      <Link className="back-link" to={appPaths.environments}><ArrowLeft aria-hidden="true" size={15} /> All environments</Link>
      <header className="page-heading"><div><span className="eyebrow">Environment profile</span><div className="environment-title-row"><h1>{environment.name}</h1><AvailabilityBadge status={environment.status} /></div><p>{environment.description}</p></div></header>
      <section className="environment-detail-grid">
        <article className="panel environment-detail-panel"><span className="panel-label">Configuration</span><dl className="detail-definition-list"><div><dt>Isolation</dt><dd>{environment.isolation}</dd></div><div><dt>Workspace</dt><dd>{environment.workspace}</dd></div><div><dt>Network</dt><dd>{environment.network}</dd></div><div><dt>Resource controls</dt><dd>{environment.resourceControls}</dd></div><div><dt>Lifecycle</dt><dd>{environment.lifecycle}</dd></div></dl></article>
        <article className="panel environment-detail-panel"><span className="panel-label">Compatibility</span><h2>Platforms</h2><div className="compatible-platform-list">{compatiblePlatforms.map((platform) => <Link key={platform.id} to={appPaths.platform(platform.id)}><span>{platform.name}</span><ArrowRight aria-hidden="true" size={15} /></Link>)}</div></article>
      </section>
      <section className="panel environment-not-ready"><CircleDashed aria-hidden="true" size={18} /><div><strong>Not provisioned</strong><p>This profile describes the intended environment. Its provisioning adapter is not connected yet.</p></div></section>
    </div>
  );
}
