import DOMPurify from "dompurify";
import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";

import { useTheme } from "../../app/theme/theme";

let renderSequence = 0;

interface MermaidDiagramProps {
  chart: string;
}

function themeToken(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Renders a repository-authored Mermaid block and keeps its SVG output sanitized.
 * Strict Mermaid settings and sanitization matter because documentation is loaded
 * into the browser and may change through contributor pull requests.
 */
export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const reactId = useId();
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    let active = true;
    const renderId = `diagram-${reactId.replaceAll(":", "")}-${renderSequence++}`;

    setSvg(null);
    setError(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });

    import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          // SVG text survives our strict sanitizer. Mermaid's HTML labels use
          // foreignObject markup, which deliberately does not.
          htmlLabels: false,
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: themeToken("--surface", "#ffffff"),
            clusterBkg: themeToken("--surface-2", "#f0f2f5"),
            clusterBorder: themeToken("--border-strong", "#d3d8e2"),
            edgeLabelBackground: themeToken("--surface", "#ffffff"),
            fontFamily: themeToken("--font-sans", "system-ui"),
            lineColor: themeToken("--accent", "#5b5bf0"),
            mainBkg: themeToken("--surface-2", "#f0f2f5"),
            nodeBorder: themeToken("--accent", "#5b5bf0"),
            primaryBorderColor: themeToken("--accent", "#5b5bf0"),
            primaryColor: themeToken("--surface-3", "#e7eaef"),
            primaryTextColor: themeToken("--text-1", "#0b1020"),
            secondaryColor: themeToken("--accent-soft", "rgba(91, 91, 240, 0.1)"),
            secondaryTextColor: themeToken("--text-1", "#0b1020"),
            tertiaryColor: themeToken("--surface", "#ffffff"),
            tertiaryTextColor: themeToken("--text-1", "#0b1020"),
          },
        });
        return mermaid.render(renderId, chart);
      })
      .then(({ svg: renderedSvg }) => {
        if (!active) return;

        setSvg(
          DOMPurify.sanitize(renderedSvg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          }),
        );
      })
      .catch((renderError: unknown) => {
        if (!active) return;
        setError(renderError instanceof Error ? renderError.message : "Mermaid could not render this diagram.");
      });

    return () => {
      active = false;
    };
  }, [chart, reactId, resolvedTheme]);

  if (error) {
    return (
      <div className="diagram-error" role="alert">
        <span>Diagram error</span>
        <code>{error}</code>
        <pre>{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="diagram-loading" aria-label="Rendering diagram" />;
  }

  const resetViewport = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const zoomBy = (amount: number) => setZoom((current) => Math.min(2.5, Math.max(0.65, current + amount)));

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.12 : -0.12);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const activeDrag = drag.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    setPan({
      x: activeDrag.panX + event.clientX - activeDrag.startX,
      y: activeDrag.panY + event.clientY - activeDrag.startY,
    });
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="mermaid-diagram">
      <div className="diagram-controls" aria-label="Diagram controls">
        <span>Scroll to zoom, drag to pan</span>
        <button aria-label="Zoom out" onClick={() => zoomBy(-0.2)} type="button">−</button>
        <button aria-label="Reset diagram view" onClick={resetViewport} type="button">Reset</button>
        <button aria-label="Zoom in" onClick={() => zoomBy(0.2)} type="button">+</button>
      </div>
      <div
        aria-label="Interactive diagram"
        className="diagram-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
        role="application"
      >
        <div
          className="diagram-canvas"
          dangerouslySetInnerHTML={{ __html: svg }}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        />
      </div>
    </div>
  );
}
