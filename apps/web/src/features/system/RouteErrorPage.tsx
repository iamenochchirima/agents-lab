import { isRouteErrorResponse, Link, useRouteError } from "react-router";

import { appPaths } from "../../routes/paths";

function errorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) return error.statusText || `Request failed with status ${error.status}.`;
  if (error instanceof Error) return error.message;
  return "The application could not load this route.";
}

export function RouteErrorPage() {
  const error = useRouteError();

  return (
    <div className="route-error-page">
      <span className="eyebrow">Route error</span>
      <h1>This page could not be loaded.</h1>
      <p>{errorMessage(error)}</p>
      <Link className="button button-primary" to={appPaths.overview}>
        Return to the lab
      </Link>
    </div>
  );
}
