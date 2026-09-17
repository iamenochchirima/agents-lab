import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  Database,
  FlaskConical,
  LayoutDashboard,
  LockKeyhole,
  Network,
  Play,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Workflow,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { ThemeToggle } from "../../app/theme/ThemeToggle";
import { appPaths } from "../../routes/paths";
import "./studio-prototype.css";

type StudioVariant = "command" | "focus" | "map";

const variants: readonly { id: StudioVariant; label: string }[] = [
  { id: "command", label: "Command center" },
  { id: "focus", label: "Component focus" },
  { id: "map", label: "System map" },
];

const studioNavigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "agents", label: "Agent systems", icon: Bot },
  { id: "components", label: "Components", icon: Boxes },
  { id: "scenarios", label: "Scenarios", icon: Workflow },
  { id: "runs", label: "Runs", icon: Play },
  { id: "evidence", label: "Evidence", icon: Search },
] as const;

const componentAreas = [
  { id: "input", number: "01", name: "Input / perception", status: "Planned", note: "Normalize what enters the agent." },
  { id: "context", number: "02", name: "Context management", status: "Designing", note: "Choose what reaches the model." },
  { id: "planning", number: "03", name: "Planning / reasoning", status: "Planned", note: "Compare ways to form a plan." },
  { id: "memory", number: "04", name: "Memory", status: "Planned", note: "Control what is remembered." },
  { id: "tools", number: "05", name: "Tool use", status: "Planned", note: "Select, validate, and execute tools." },
  { id: "control", number: "06", name: "Control / orchestration", status: "Planned", note: "Coordinate the agent loop." },
  { id: "execution", number: "07", name: "Execution environment", status: "Planned", note: "Constrain the world it can touch." },
  { id: "output", number: "08", name: "Output / actions", status: "Planned", note: "Verify and render the result." },
  { id: "safety", number: "09", name: "Safety / guardrails", status: "Planned", note: "Detect risk and runaway behaviour." },
  { id: "model", number: "10", name: "Model interface", status: "Planned", note: "Route and instrument model calls." },
  { id: "observability", number: "11", name: "Observability", status: "Planned", note: "Leave behind inspectable evidence." },
] as const;

const contextStrategies = [
  { name: "Full history", description: "Keep all available conversation turns." },
  { name: "Sliding window", description: "Retain the most recent turns." },
  { name: "Relevance ranked", description: "Retain the highest-value context." },
] as const;

function parseVariant(value: string | null): StudioVariant {
  return variants.some((variant) => variant.id === value) ? (value as StudioVariant) : "command";
}

function StudioTopbar() {
  return (
    <header className="studio-topbar">
      <Link aria-label="Leave Studio" className="studio-back" to={appPaths.overview}>
        <ArrowLeft aria-hidden="true" size={16} />
      </Link>
      <div className="studio-brand">
        <div className="studio-brand-mark"><Sparkles aria-hidden="true" size={16} /></div>
        <div>
          <strong>Studio</strong>
          <span>agent harness lab</span>
        </div>
      </div>
      <div className="studio-topbar-spacer" />
      <span className="studio-prototype-pill">Prototype</span>
      <span className="studio-environment-pill"><span className="studio-live-dot" /> Local environment</span>
      <ThemeToggle />
    </header>
  );
}

function StudioNavigation({ active = "overview", onNavigate }: { active?: string; onNavigate?: (id: string) => void }) {
  return (
    <nav aria-label="Studio navigation" className="studio-navigation">
      <span className="studio-nav-label">Studio</span>
      {studioNavigation.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={`studio-nav-item ${item.id === active ? "is-active" : ""}`}
            key={item.id}
            onClick={() => onNavigate?.(item.id)}
            type="button"
          >
            <Icon aria-hidden="true" size={16} />
            <span>{item.label}</span>
            {item.id === "components" && <span className="studio-nav-count">11</span>}
          </button>
        );
      })}
      <div className="studio-nav-divider" />
      <span className="studio-nav-label">Reference environment</span>
      <button className="studio-nav-item studio-nav-muted" type="button"><Database aria-hidden="true" size={16} /><span>Storage</span></button>
      <button className="studio-nav-item studio-nav-muted" type="button"><ShieldCheck aria-hidden="true" size={16} /><span>Permissions</span></button>
      <button className="studio-nav-item studio-nav-muted" type="button"><SquareTerminal aria-hidden="true" size={16} /><span>Adapters</span></button>
    </nav>
  );
}

function StudioFrame({ children, navigation = "overview", onNavigate }: { children: ReactNode; navigation?: string; onNavigate?: (id: string) => void }) {
  return (
    <div className="studio-frame">
      <aside className="studio-sidebar">
        <StudioNavigation active={navigation} onNavigate={onNavigate} />
        <div className="studio-sidebar-footer">
          <div className="studio-sidebar-status"><span className="studio-live-dot" /><span>Environment ready for design</span></div>
          <p>Local state only. No runs or metrics are created by this prototype.</p>
        </div>
      </aside>
      <main className="studio-content">{children}</main>
    </div>
  );
}

function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="studio-section-heading">
      <div><span className="studio-eyebrow">{eyebrow}</span><h2>{title}</h2></div>
      {action}
    </div>
  );
}

function StatusLabel({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ready" }) {
  return <span className={`studio-status studio-status-${tone}`}>{children}</span>;
}

function EnvironmentCard({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`studio-card studio-environment-card ${compact ? "is-compact" : ""}`}>
      <div className="studio-card-heading">
        <div className="studio-card-icon"><Network aria-hidden="true" size={18} /></div>
        <StatusLabel tone="accent">Draft</StatusLabel>
      </div>
      <span className="studio-card-kicker">Reference environment</span>
      <h3>Neutral agent runtime</h3>
      <p>One controlled execution environment for composing and comparing harness strategies.</p>
      <div className="studio-environment-facts">
        <span><Bot size={14} /> Model adapter <strong>Replay</strong></span>
        <span><Database size={14} /> Persistence <strong>Local</strong></span>
        <span><ShieldCheck size={14} /> Side effects <strong>Contained</strong></span>
      </div>
      {!compact && <button className="studio-secondary-button" disabled type="button">Configure environment <ArrowRight size={14} /></button>}
    </section>
  );
}

function ComponentSummaryCard({ area, onOpen }: { area: (typeof componentAreas)[number]; onOpen: () => void }) {
  const available = area.id === "context";
  return (
    <button className={`studio-component-card ${available ? "is-available" : ""}`} disabled={!available} onClick={available ? onOpen : undefined} type="button">
      <span className="studio-component-card-top"><span className="studio-component-number">{area.number}</span><StatusLabel tone={available ? "accent" : "neutral"}>{area.status}</StatusLabel></span>
      <strong>{area.name}</strong>
      <span>{area.note}</span>
      {available && <span className="studio-card-link">Open workspace <ArrowRight size={13} /></span>}
    </button>
  );
}

function CommandCenter({ onOpenComponents }: { onOpenComponents: () => void }) {
  return (
    <StudioFrame onNavigate={(id) => id === "components" && onOpenComponents()}>
      <div className="studio-page-intro">
        <div>
          <span className="studio-eyebrow">Agent systems / overview</span>
          <h1>Build the agent. Study the parts.</h1>
          <p>Studio gives the whole harness a controlled home. Configure the environment, choose what to vary, and keep the evidence inspectable.</p>
        </div>
        <div className="studio-intro-actions"><button className="studio-primary-button" disabled type="button"><Plus size={15} /> New agent system</button><button className="studio-quiet-button" type="button"><Code2 size={15} /> View definition</button></div>
      </div>

      <div className="studio-dashboard-grid">
        <EnvironmentCard />
        <section className="studio-card studio-agent-card">
          <div className="studio-card-heading"><div className="studio-card-icon"><Bot aria-hidden="true" size={18} /></div><StatusLabel>Not configured</StatusLabel></div>
          <span className="studio-card-kicker">Agent system</span>
          <h3>Start with a clean composition</h3>
          <p>Choose baseline implementations for the harness areas you want to exercise.</p>
          <div className="studio-agent-line"><span className="studio-avatar"><Bot size={15} /></span><span>Untitled agent</span><ChevronDown size={15} /></div>
        </section>
      </div>

      <section className="studio-section-block">
        <SectionHeading eyebrow="The system surface" title="Components" action={<button className="studio-text-button" onClick={onOpenComponents} type="button">Open all components <ArrowRight size={14} /></button>} />
        <p className="studio-section-copy">Every major harness concern is visible here. Context Management is the first workspace; the rest are named and ready to be developed in the same environment.</p>
        <div className="studio-component-grid">{componentAreas.map((area) => <ComponentSummaryCard area={area} key={area.id} onOpen={onOpenComponents} />)}</div>
      </section>

      <section className="studio-empty-run-card">
        <div className="studio-empty-run-icon"><Clock3 size={18} /></div>
        <div><span className="studio-eyebrow">Run history</span><h2>No runs yet</h2><p>Once an environment and scenario are configured, completed runs will appear here with their trajectory and evidence.</p></div>
        <button className="studio-secondary-button" disabled type="button">Browse runs <ArrowRight size={14} /></button>
      </section>
    </StudioFrame>
  );
}

function ContextFocus({ onBack }: { onBack: () => void }) {
  const [selectedStrategy, setSelectedStrategy] = useState(0);

  return (
    <div className="studio-focus-layout">
      <aside className="studio-focus-sidebar">
        <div className="studio-component-nav-heading"><span className="studio-eyebrow">11 areas</span><strong>Component Lab</strong></div>
        <ComponentsNavigation activeId="context" />
        <div className="studio-component-sidebar-note"><LockKeyhole aria-hidden="true" size={15} /><div><strong>Preview state</strong><p>Selections live in browser memory and are never sent to the server.</p></div></div>
      </aside>
      <section className="studio-focus-main">
        <button className="studio-back-button studio-focus-back" onClick={onBack} type="button"><ArrowLeft size={14} /> All components</button>
        <div className="studio-focus-heading"><div><span className="studio-eyebrow">Component / context management</span><div className="studio-title-line"><h1>Context Management</h1><StatusLabel tone="accent">Designing</StatusLabel></div><p>Decide what reaches the model this turn, then inspect the trade-offs.</p></div></div>
        <section className="studio-card studio-strategy-card">
          <SectionHeading eyebrow="One changing variable" title="Context strategy" action={<span className="studio-muted-count">{contextStrategies.length} available</span>} />
          <div className="studio-strategy-list">{contextStrategies.map((strategy, index) => <button className={`studio-strategy-option ${index === selectedStrategy ? "is-selected" : ""}`} key={strategy.name} onClick={() => setSelectedStrategy(index)} type="button"><span className="studio-radio" /><span><strong>{strategy.name}</strong><small>{strategy.description}</small></span>{index === selectedStrategy && <Check className="studio-option-check" size={15} />}</button>)}</div>
        </section>
        <section className="studio-card studio-case-card">
          <SectionHeading eyebrow="Fixed input" title="Scenario case" action={<span className="studio-muted-count">Same for every trial</span>} />
          <div className="studio-case-detail"><strong>Old important fact</strong><span>Find a detail introduced near the beginning of a long conversation.</span><div><span className="studio-eyebrow">Task</span><strong>What language should the support agent use for my account?</strong></div></div>
        </section>
        <section className="studio-card studio-envelope-card"><SectionHeading eyebrow="Controlled conditions" title="Fixed environment" action={<span className="studio-lock-label"><LockKeyhole size={14} /> Locked for comparison</span>} /><div className="studio-envelope-row"><div><span>Model</span><strong>Deterministic replay</strong></div><div><span>Context window</span><strong>1,200 tokens</strong></div><div><span>Output reserve</span><strong>240 tokens</strong></div><div><span>Safety margin</span><strong>60 tokens</strong></div></div></section>
        <section className="studio-run-strip"><div className="studio-run-strip-icon"><FlaskConical size={17} /></div><div><strong>Ready to define a comparison</strong><p>The execution runner is the next Studio slice. This prototype only holds configuration in browser memory.</p></div><button className="studio-primary-button" disabled type="button"><Play size={14} /> Run comparison</button></section>
      </section>
    </div>
  );
}

function ComponentsNavigation({ activeId }: { activeId: string }) {
  return (
    <nav aria-label="Component areas" className="studio-component-nav-list">
      {componentAreas.map((area) => (
        <button className={`studio-component-nav-item ${area.id === activeId ? "is-active" : ""}`} disabled={area.id !== activeId} key={area.id} type="button">
          <span>{area.number}</span><strong>{area.name}</strong>
        </button>
      ))}
    </nav>
  );
}

function SystemMap({ onOpenComponents }: { onOpenComponents: () => void }) {
  const path = [
    { name: "Input", icon: SlidersHorizontal, tone: "blue" },
    { name: "Context", icon: Database, tone: "violet" },
    { name: "Model", icon: Bot, tone: "gold" },
    { name: "Tools", icon: Wrench, tone: "green" },
    { name: "Output", icon: ArrowRight, tone: "rose" },
  ] as const;

  return (
    <StudioFrame navigation="agents" onNavigate={(id) => id === "components" && onOpenComponents()}>
      <div className="studio-map-heading"><div><span className="studio-eyebrow">Agent system / neutral runtime</span><h1>Compose the whole harness</h1><p>See the execution path at a glance, then open any area when you want to vary its implementation.</p></div><div className="studio-map-actions"><StatusLabel tone="accent">Draft system</StatusLabel><button className="studio-primary-button" disabled type="button"><Play size={14} /> Run agent</button></div></div>
      <section className="studio-card studio-map-card"><div className="studio-map-card-heading"><div><span className="studio-eyebrow">Execution path</span><h2>One system, many seams</h2></div><span className="studio-map-caption"><LockKeyhole size={14} /> Baseline conditions fixed</span></div><div className="studio-execution-path">{path.map((item, index) => { const Icon = item.icon; return <div className="studio-path-step-group" key={item.name}><div className={`studio-path-node studio-path-node-${item.tone}`}><Icon size={20} /><span>{item.name}</span><small>{item.name === "Context" ? "1 strategy selected" : "Baseline"}</small></div>{index < path.length - 1 && <div className="studio-path-connector"><ArrowRight size={16} /></div>}</div>; })}</div><div className="studio-map-note"><Network size={16} /><span>The system is composed as one runtime. A component experiment changes one node while the surrounding path stays fixed.</span><button className="studio-text-button" onClick={onOpenComponents} type="button">Inspect components <ArrowRight size={14} /></button></div></section>
      <div className="studio-map-lower-grid"><section className="studio-card studio-inventory-card"><SectionHeading eyebrow="System inventory" title="Harness areas" action={<span className="studio-muted-count">1 designing / 10 planned</span>} /><div className="studio-inventory-list">{componentAreas.map((area) => <button className={`studio-inventory-row ${area.id === "context" ? "is-active" : ""}`} key={area.id} onClick={area.id === "context" ? onOpenComponents : undefined} type="button"><span className="studio-component-number">{area.number}</span><span><strong>{area.name}</strong><small>{area.note}</small></span><StatusLabel tone={area.id === "context" ? "accent" : "neutral"}>{area.status}</StatusLabel></button>)}</div></section><section className="studio-card studio-definition-card"><SectionHeading eyebrow="Configuration" title="Agent definition" action={<Code2 size={16} />} /><pre>{`agent: untitled\nenvironment: neutral-runtime\nmodel: replay-adapter\ncomponents:\n  context: full-history\n  memory: baseline\n  tools: baseline\n  control: baseline`}</pre><button className="studio-secondary-button" disabled type="button">Edit definition <ArrowRight size={14} /></button></section></div>
    </StudioFrame>
  );
}

function VariantSwitcher({ active, onChange }: { active: StudioVariant; onChange: (variant: StudioVariant) => void }) {
  return <div aria-label="Studio prototype views" className="studio-variant-switcher"><span>Prototype views</span>{variants.map((variant) => <button className={variant.id === active ? "is-active" : ""} key={variant.id} onClick={() => onChange(variant.id)} type="button">{variant.label}</button>)}</div>;
}

export function StudioPrototypePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [variant, setVariant] = useState<StudioVariant>(() => parseVariant(searchParams.get("variant")));

  function selectVariant(next: StudioVariant) {
    setVariant(next);
    setSearchParams({ variant: next });
  }

  return (
    <div className="studio-prototype">
      <StudioTopbar />
      {variant === "command" && <CommandCenter onOpenComponents={() => selectVariant("focus")} />}
      {variant === "focus" && <StudioFrame navigation="components" onNavigate={(id) => id === "overview" && selectVariant("command")}><ContextFocus onBack={() => selectVariant("command")} /></StudioFrame>}
      {variant === "map" && <SystemMap onOpenComponents={() => selectVariant("focus")} />}
      {variant !== "focus" && <VariantSwitcher active={variant} onChange={selectVariant} />}
    </div>
  );
}
