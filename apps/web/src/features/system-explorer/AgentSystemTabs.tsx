import type { ReactNode } from 'react';
import { Link } from 'react-router';
import './agent-system-tabs.css';

const pages = [
  { id: 'lina', name: 'Lina' },
  { id: 'hermes', name: 'Hermes' },
  { id: 'openclaw', name: 'OpenClaw' },
  { id: 'pi', name: 'Pi' },
  { id: 'waku', name: 'Waku Agent' },
];

/** Peer page navigation shared by Lina and the source explorers. */
export function AgentSystemTabs({ active, children, showIndex = false }: { active: string; children?: ReactNode; showIndex?: boolean }) {
  return <nav className="agent-system-tabs" aria-label="Agent system">
    {showIndex && <Link to="/studio/explorers">All explorers</Link>}
    {pages.map(page => <Link key={page.id} to={`/studio/${page.id}`} aria-current={active === page.id ? 'page' : undefined}>{page.name}</Link>)}
    {children}
  </nav>;
}
