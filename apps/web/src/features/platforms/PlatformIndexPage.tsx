import { Navigate } from "react-router";

import { appPaths } from "../../routes/paths";

export function PlatformIndexPage() {
  return <Navigate replace to={appPaths.platform("computer-native")} />;
}
