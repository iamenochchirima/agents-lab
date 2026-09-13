import { documents } from "../../generated/document-catalog";
import { OverviewView } from "./OverviewView";

export function OverviewPage() {
  return <OverviewView documents={documents} />;
}
