import { ChevronRight, FileText, FolderOpen } from "lucide-react";
import type { RepositoryNode } from "../../generated/document-catalog";
import { useState } from "react";

interface RepositoryMapViewProps {
  tree: readonly RepositoryNode[];
}

interface TreeNodeProps {
  depth: number;
  node: RepositoryNode;
}

function TreeNode({ depth, node }: TreeNodeProps) {
  if (node.kind === "file") {
    return (
      <div className="tree-file" style={{ paddingLeft: `${depth * 20 + 12}px` }}>
        <span className="tree-icon" aria-hidden="true">
          <FileText size={14} />
        </span>
        <code>{node.name}</code>
      </div>
    );
  }

  return <DirectoryNode depth={depth} node={node} />;
}

function DirectoryNode({ depth, node }: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 1);

  return (
    <details
      className="tree-directory"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary style={{ paddingLeft: `${depth * 20 + 12}px` }}>
        <span className="tree-icon" aria-hidden="true">
          {depth === 0 ? <FolderOpen size={15} /> : <ChevronRight className="tree-chevron" size={15} />}
        </span>
        <strong>{node.name}</strong>
        {node.description && <span className="tree-description">{node.description}</span>}
      </summary>
      <div className="tree-children">
        {node.children.map((child) => (
          <TreeNode depth={depth + 1} key={child.path} node={child} />
        ))}
      </div>
    </details>
  );
}

export function RepositoryMapView({ tree }: RepositoryMapViewProps) {
  return (
    <div className="page-content">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Repository structure</span>
          <h1>Every directory has a job.</h1>
          <p>
            Expand the tree to see where the control plane, platforms, environments, scenarios, experiments, and evidence belong.
          </p>
        </div>
      </section>

      <section className="panel repository-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Generated file map</span>
            <h2>agents-lab</h2>
          </div>
          <p>Directory summaries come from nearby README files.</p>
        </div>
        <div className="repository-tree">
          {tree.map((node) => (
            <TreeNode depth={0} key={node.path} node={node} />
          ))}
        </div>
      </section>
    </div>
  );
}
