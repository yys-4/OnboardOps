import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface ServiceNode {
  id: string;
  label: string;
  type: 'frontend' | 'backend' | 'data' | 'infra' | 'external';
  x?: number;
  y?: number;
}

interface ServiceEdge {
  source: string;
  target: string;
  label?: string;
  protocol?: 'HTTP' | 'gRPC' | 'TCP' | 'pubsub';
}

const NODES: ServiceNode[] = [
  { id: 'dashboard',        label: 'Dashboard\n(React)',         type: 'frontend' },
  { id: 'backend',          label: 'Backend\n(Node/Express)',    type: 'backend' },
  { id: 'incident-manager', label: 'Incident\nManager (FastAPI)',type: 'backend' },
  { id: 'postgres',         label: 'PostgreSQL',                 type: 'data' },
  { id: 'redis',            label: 'Redis',                      type: 'data' },
  { id: 'otel-collector',   label: 'OTel\nCollector',            type: 'infra' },
  { id: 'jaeger',           label: 'Jaeger',                     type: 'infra' },
  { id: 'prometheus',       label: 'Prometheus',                 type: 'infra' },
  { id: 'grafana',          label: 'Grafana',                    type: 'infra' },
  { id: 'openai',           label: 'OpenAI API',                 type: 'external' },
];

const EDGES: ServiceEdge[] = [
  { source: 'dashboard',        target: 'backend',          label: 'REST', protocol: 'HTTP' },
  { source: 'dashboard',        target: 'incident-manager', label: 'REST', protocol: 'HTTP' },
  { source: 'backend',          target: 'postgres',         label: 'SQL',  protocol: 'TCP' },
  { source: 'backend',          target: 'redis',            label: 'cache/pub', protocol: 'TCP' },
  { source: 'backend',          target: 'otel-collector',   label: 'OTLP', protocol: 'gRPC' },
  { source: 'incident-manager', target: 'postgres',         label: 'SQL',  protocol: 'TCP' },
  { source: 'incident-manager', target: 'redis',            label: 'cache', protocol: 'TCP' },
  { source: 'incident-manager', target: 'backend',          label: 'REST', protocol: 'HTTP' },
  { source: 'incident-manager', target: 'otel-collector',   label: 'OTLP', protocol: 'gRPC' },
  { source: 'incident-manager', target: 'openai',           label: 'AI',   protocol: 'HTTP' },
  { source: 'otel-collector',   target: 'jaeger',           label: 'traces', protocol: 'gRPC' },
  { source: 'otel-collector',   target: 'prometheus',       label: 'metrics', protocol: 'HTTP' },
  { source: 'prometheus',       target: 'grafana',          label: 'query', protocol: 'HTTP' },
];

const TYPE_COLORS: Record<string, string> = {
  frontend: '#6366f1',
  backend:  '#0ea5e9',
  data:     '#a855f7',
  infra:    '#f59e0b',
  external: '#6b7280',
};

export default function ArchitecturePage() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const W = svgRef.current.clientWidth || 800;
    const H = 600;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', `0 0 ${W} ${H}`);

    // Arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 28)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#4b5563');

    const nodes = NODES.map(n => ({ ...n })) as any[];
    const edges = EDGES.map(e => ({ ...e }));

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((d: any) => d.id).distance(130))
      .force('charge', d3.forceManyBody().strength(-600))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(50));

    const link = svg.append('g').selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', '#2a2d3e')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrow)');

    const linkLabel = svg.append('g').selectAll('text')
      .data(edges)
      .join('text')
      .attr('font-size', 9)
      .attr('fill', '#6b7280')
      .text((d: any) => d.label ?? '');

    const node = svg.append('g').selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(
        (d3.drag<SVGGElement, any>()
          .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
        ) as any
      );

    node.append('circle')
      .attr('r', 28)
      .attr('fill', (d: any) => TYPE_COLORS[d.type] + '33')
      .attr('stroke', (d: any) => TYPE_COLORS[d.type])
      .attr('stroke-width', 2);

    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', 9)
      .attr('fill', '#e2e8f0')
      .selectAll('tspan')
      .data((d: any) => d.label.split('\n'))
      .join('tspan')
      .attr('x', 0)
      .attr('dy', (_: any, i: number, arr: any) => i === 0 ? `-${(arr.length - 1) * 0.5}em` : '1.2em')
      .text((d: any) => d);

    sim.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      linkLabel
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2 - 5);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => { sim.stop(); };
  }, []);

  // Legend
  const legendItems = Object.entries(TYPE_COLORS);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Architecture</h1>
        <p className="text-slate-400 text-sm mt-1">Service dependency graph — drag nodes to explore</p>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <svg ref={svgRef} className="w-full" style={{ height: 600 }} />
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap">
        {legendItems.map(([type, color]) => (
          <div key={type} className="flex items-center gap-2 text-xs text-slate-400">
            <span className="w-3 h-3 rounded-full" style={{ background: color }} />
            <span className="capitalize">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
