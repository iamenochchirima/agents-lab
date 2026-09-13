import { documentsWithContent } from "../documentation/documentSource";
import { ArchitectureView } from "./ArchitectureView";

export function ArchitecturePage() {
  return <ArchitectureView documents={documentsWithContent} />;
}
