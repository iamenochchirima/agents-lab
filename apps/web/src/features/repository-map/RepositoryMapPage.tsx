import { repositoryTree } from "../../generated/document-catalog";
import { RepositoryMapView } from "./RepositoryMapView";

export function RepositoryMapPage() {
  return <RepositoryMapView tree={repositoryTree} />;
}
