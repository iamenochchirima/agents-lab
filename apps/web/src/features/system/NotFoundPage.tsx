import { CircleAlert } from "lucide-react";
import { Link } from "react-router";

import { appPaths } from "../../routes/paths";

export function NotFoundPage() {
  return (
    <div className="page-content basic-page">
      <section className="content-panel route-not-found">
        <span className="basic-empty-mark" aria-hidden="true"><CircleAlert size={18} /></span>
        <h1>Page not found</h1>
        <p>The address does not match a page in Agent Harness Lab.</p>
        <Link className="button button-secondary-light" to={appPaths.overview}>Return to overview</Link>
      </section>
    </div>
  );
}
