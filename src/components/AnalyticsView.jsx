import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import Skeleton from './common/Skeleton';
import '../styles/analytics.css';

// Minimalist Monochrome Palette strictly: black, slate, and gray tones
const MONO_PALETTE = ['#0f172a', '#334155', '#64748b', '#94a3b8', '#cbd5e1'];

/**
 * Reusable Pie/Donut Chart component matching user's exact visual reference
 * Features:
 * - Solid Pie or Donut Ring
 * - Angled pointer callout leader lines to values
 * - Bottom legend with square indicators
 * - Interactive hover states: slice expansion, opacity dimming of unhovered slices,
 *   floating tooltip details, and two-way legend hovering
 */
function CalloutCircleChart({
  title,
  data = [],
  isDonut = false,
  width = 400,
  height = 240,
  outerRadius = 84,
  innerRadius = 48,
  headerAction = null,
  showHoverLegendOnly = false,
  emptyMessage = 'No records found'
}) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, title: '', value: '', pct: '' });
  const containerRef = useRef(null);

  const cx = width / 2;
  const cy = height / 2;

  const total = useMemo(() => {
    return data.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  }, [data]);

  const slices = useMemo(() => {
    if (total === 0 || data.length === 0) return [];

    // Strictly 1 item in total dataset
    if (data.length === 1) {
      const item = data[0];
      const isRight = true;
      const p1 = { x: cx + outerRadius, y: cy };
      const p2 = { x: cx + outerRadius + 14, y: cy };
      const p3 = { x: p2.x + 18, y: p2.y };
      return [
        {
          ...item,
          isFullCircle: true,
          color: item.color || MONO_PALETTE[0],
          p1,
          p2,
          p3,
          labelX: p3.x + 4,
          labelY: p3.y + 4,
          textAnchor: 'start',
          showLeader: true,
          pct: '100'
        }
      ];
    }

    // Multiple items (e.g. 2 or more pipelines, even if one has 0 leads)
    const zeroCount = data.filter((d) => (Number(d.value) || 0) === 0).length;
    const reservedZeroFraction = zeroCount > 0 ? 0.015 * zeroCount : 0;
    const remainingFraction = 1 - reservedZeroFraction;

    let currentAngle = -Math.PI / 2; // Start at 12 o'clock

    return data.map((item, index) => {
      const val = Number(item.value) || 0;
      const fraction = val === 0 ? 0.015 : (val / total) * remainingFraction;
      const sliceAngle = fraction * 2 * Math.PI;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;
      currentAngle = endAngle;

      const largeArc = sliceAngle > Math.PI ? 1 : 0;

      // Outer circle coordinates
      const x1 = cx + outerRadius * Math.cos(startAngle);
      const y1 = cy + outerRadius * Math.sin(startAngle);
      const x2 = cx + outerRadius * Math.cos(endAngle);
      const y2 = cy + outerRadius * Math.sin(endAngle);

      let pathD = '';
      if (!isDonut) {
        // Solid Pie slice
        pathD = `M ${cx} ${cy} L ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      } else {
        // Donut Ring slice
        const ix1 = cx + innerRadius * Math.cos(startAngle);
        const iy1 = cy + innerRadius * Math.sin(startAngle);
        const ix2 = cx + innerRadius * Math.cos(endAngle);
        const iy2 = cy + innerRadius * Math.sin(endAngle);
        pathD = `M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
      }

      // Angled pointer callout line
      const midAngle = startAngle + sliceAngle / 2;
      const p1 = {
        x: cx + outerRadius * Math.cos(midAngle),
        y: cy + outerRadius * Math.sin(midAngle)
      };
      const p2 = {
        x: cx + (outerRadius + 14) * Math.cos(midAngle),
        y: cy + (outerRadius + 14) * Math.sin(midAngle)
      };
      const isRight = Math.cos(midAngle) >= 0;
      const p3 = {
        x: p2.x + (isRight ? 16 : -16),
        y: p2.y
      };
      const labelX = p3.x + (isRight ? 4 : -4);
      const labelY = p3.y + 4;
      const textAnchor = isRight ? 'start' : 'end';

      return {
        ...item,
        isFullCircle: false,
        pathD,
        p1,
        p2,
        p3,
        labelX,
        labelY,
        textAnchor,
        color: val === 0 ? '#cbd5e1' : item.color || MONO_PALETTE[index % MONO_PALETTE.length],
        showLeader: true,
        pct: total > 0 ? ((val / total) * 100).toFixed(1) : '0'
      };
    });
  }, [data, total, cx, cy, outerRadius, innerRadius, isDonut]);

  const handleSliceHover = (index, slice, e) => {
    setHoveredIndex(index);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setTooltip({
        visible: true,
        x,
        y: Math.max(y - 12, 10),
        title: slice.name,
        value: slice.formattedValue || slice.value,
        pct: slice.pct
      });
    }
  };

  const handleMouseMove = (e) => {
    if (containerRef.current && hoveredIndex !== null) {
      const rect = containerRef.current.getBoundingClientRect();
      setTooltip((prev) => ({
        ...prev,
        x: e.clientX - rect.left,
        y: Math.max(e.clientY - rect.top - 12, 10)
      }));
    }
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setTooltip((prev) => ({ ...prev, visible: false }));
  };

  if (total === 0 || data.length === 0) {
    return (
      <div className="analytics-visual-card">
        <div className="analytics-card-header">
          <h3 className="analytics-card-title">{title}</h3>
          {headerAction}
        </div>
        <div className="analytics-chart-empty">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="analytics-visual-card">
      <div className="analytics-card-header">
        <h3 className="analytics-card-title">{title}</h3>
        {headerAction}
      </div>

      <div
        className="analytics-chart-svg-box"
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Floating Tooltip */}
        {tooltip.visible && (
          <div
            className="analytics-floating-tooltip"
            style={{
              left: `${tooltip.x}px`,
              top: `${tooltip.y}px`
            }}
          >
            <div className="analytics-tooltip-title">{tooltip.title}</div>
            <div className="analytics-tooltip-val">
              {tooltip.value} <span className="analytics-tooltip-pct">({tooltip.pct}%)</span>
            </div>
          </div>
        )}

        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="analytics-circle-svg"
        >
          {/* Pie / Donut Slices */}
          {slices.map((slice, i) => {
            const isHovered = hoveredIndex === i;
            const opacity = hoveredIndex === null ? 1 : isHovered ? 1 : 0.4;
            const transform = isHovered ? 'scale(1.03)' : 'scale(1)';

            if (slice.isFullCircle) {
              if (!isDonut) {
                return (
                  <circle
                    key={i}
                    cx={cx}
                    cy={cy}
                    r={outerRadius}
                    fill={slice.color}
                    style={{
                      cursor: 'pointer',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      transformOrigin: `${cx}px ${cy}px`,
                      transform,
                      opacity
                    }}
                    onMouseEnter={(e) => handleSliceHover(i, slice, e)}
                  />
                );
              }
              const strokeWidth = outerRadius - innerRadius;
              const ringR = (outerRadius + innerRadius) / 2;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={ringR}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={strokeWidth}
                  style={{
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    transformOrigin: `${cx}px ${cy}px`,
                    transform,
                    opacity
                  }}
                  onMouseEnter={(e) => handleSliceHover(i, slice, e)}
                />
              );
            }
            return (
              <path
                key={i}
                d={slice.pathD}
                fill={slice.color}
                stroke="#ffffff"
                strokeWidth={isHovered ? 2.5 : 1.5}
                style={{
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  transformOrigin: `${cx}px ${cy}px`,
                  transform,
                  opacity
                }}
                onMouseEnter={(e) => handleSliceHover(i, slice, e)}
              />
            );
          })}

          {/* Angled Leader Lines and Callout Labels */}
          {slices.map((slice, i) =>
            slice.showLeader ? (
              <g
                key={`leader-${i}`}
                style={{
                  cursor: 'pointer',
                  transition: 'opacity 0.2s ease',
                  opacity: hoveredIndex === null || hoveredIndex === i ? 1 : 0.4
                }}
                onMouseEnter={(e) => handleSliceHover(i, slice, e)}
              >
                <polyline
                  points={`${slice.p1.x},${slice.p1.y} ${slice.p2.x},${slice.p2.y} ${slice.p3.x},${slice.p3.y}`}
                  fill="none"
                  stroke={hoveredIndex === i ? '#0f172a' : '#94a3b8'}
                  strokeWidth={hoveredIndex === i ? 1.5 : 1}
                />
                <text
                  x={slice.labelX}
                  y={slice.labelY}
                  textAnchor={slice.textAnchor}
                  className="analytics-callout-text"
                  fill={hoveredIndex === i ? '#0f172a' : '#334155'}
                  fontWeight={hoveredIndex === i ? 700 : 600}
                >
                  {slice.formattedValue || slice.value}
                </text>
              </g>
            ) : null
          )}
        </svg>
      </div>

      {/* Clean Bottom Legend or Hover-Only Dynamic Bar */}
      {showHoverLegendOnly ? (
        <div className="analytics-hover-legend-bar">
          {hoveredIndex !== null && slices[hoveredIndex] ? (
            <div className="analytics-hover-legend-active">
              <span
                className="analytics-hover-legend-dot"
                style={{ backgroundColor: slices[hoveredIndex].color }}
              />
              <span className="analytics-hover-legend-name">{slices[hoveredIndex].name}</span>
              <span className="analytics-hover-legend-detail">
                {slices[hoveredIndex].formattedValue || slices[hoveredIndex].value} leads ({slices[hoveredIndex].pct}%)
              </span>
            </div>
          ) : (
            <span className="analytics-hover-legend-hint">
              Hover over slices to inspect stage breakdown
            </span>
          )}
        </div>
      ) : (
        <div className="analytics-square-legend">
          {data.map((item, idx) => {
            const isHovered = hoveredIndex === idx;
            const sliceInfo = slices[idx] || item;
            return (
              <div
                key={idx}
                className={`analytics-square-legend-item ${isHovered ? 'active' : ''}`}
                onMouseEnter={(e) => handleSliceHover(idx, sliceInfo, e)}
                onMouseLeave={handleMouseLeave}
              >
                <span
                  className="analytics-square-legend-box"
                  style={{
                    backgroundColor: item.color || MONO_PALETTE[idx % MONO_PALETTE.length]
                  }}
                />
                <span className="analytics-square-legend-label">{item.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnalyticsSkeleton({ isGlobal = true }) {
  if (!isGlobal) {
    return (
      <div className="analytics-view-wrapper">
        {/* Area Graph Skeleton on Top */}
        <div className="analytics-visual-card">
          <div className="analytics-card-header">
            <Skeleton width="170px" height="18px" />
            <Skeleton width="85px" height="24px" borderRadius="4px" />
          </div>
          <div className="analytics-graph-container" style={{ padding: '10px 0' }}>
            <Skeleton width="100%" height="150px" borderRadius="6px" />
          </div>
        </div>

        {/* 1 Row of 2 Circle Charts Skeleton */}
        <div className="analytics-split-grid">
          {[1, 2].map((i) => (
            <div key={i} className="analytics-visual-card">
              <Skeleton width="130px" height="18px" />
              <div className="analytics-chart-svg-box" style={{ height: '240px' }}>
                <Skeleton circle height="168px" width="168px" borderRadius="50%" />
              </div>
              <div className="analytics-square-legend" style={{ justifyContent: 'center' }}>
                <Skeleton width="160px" height="12px" />
              </div>
            </div>
          ))}
        </div>

        {/* Column Bar Graph Skeleton */}
        <div className="analytics-visual-card">
          <div className="analytics-card-header">
            <Skeleton width="160px" height="18px" />
            <Skeleton width="110px" height="30px" borderRadius="6px" />
          </div>
          <div className="analytics-columns-chart-container">
            {[40, 75, 55, 90, 65, 30, 20].map((h, i) => (
              <div key={i} className="analytics-bar-col">
                <Skeleton width="20px" height="12px" />
                <div className="analytics-bar-track">
                  <Skeleton width="100%" height={`${h}%`} borderRadius="3px 3px 0 0" />
                </div>
                <Skeleton width="24px" height="12px" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-view-wrapper">
      {/* 4 Metric Tiles Skeleton */}
      <div className="analytics-metrics-grid">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="analytics-metric-tile">
            <Skeleton width="75px" height="12px" />
            <Skeleton width="90px" height="34px" style={{ margin: '4px 0 2px 0' }} />
          </div>
        ))}
      </div>

      {/* 2x2 Circle Charts Skeleton */}
      <div className="analytics-split-grid">
        {[1, 2].map((i) => (
          <div key={i} className="analytics-visual-card">
            <Skeleton width="130px" height="18px" />
            <div className="analytics-chart-svg-box" style={{ height: '240px' }}>
              <Skeleton circle height="168px" width="168px" borderRadius="50%" />
            </div>
            <div className="analytics-square-legend" style={{ justifyContent: 'center' }}>
              <Skeleton width="160px" height="12px" />
            </div>
          </div>
        ))}
      </div>

      <div className="analytics-split-grid">
        {[3, 4].map((i) => (
          <div key={i} className="analytics-visual-card">
            <Skeleton width="140px" height="18px" />
            <div className="analytics-chart-svg-box" style={{ height: '240px' }}>
              <Skeleton circle height="168px" width="168px" borderRadius="50%" />
            </div>
            <div className="analytics-square-legend" style={{ justifyContent: 'center' }}>
              <Skeleton width="170px" height="12px" />
            </div>
          </div>
        ))}
      </div>

      {/* Area Graph Skeleton */}
      <div className="analytics-visual-card">
        <div className="analytics-card-header">
          <Skeleton width="170px" height="18px" />
          <Skeleton width="85px" height="24px" borderRadius="4px" />
        </div>
        <div className="analytics-graph-container" style={{ padding: '10px 0' }}>
          <Skeleton width="100%" height="150px" borderRadius="6px" />
        </div>
      </div>

      {/* Column Bar Graph Skeleton */}
      <div className="analytics-visual-card">
        <div className="analytics-card-header">
          <Skeleton width="160px" height="18px" />
          <Skeleton width="110px" height="30px" borderRadius="6px" />
        </div>
        <div className="analytics-columns-chart-container">
          {[40, 75, 55, 90, 65, 30, 20].map((h, i) => (
            <div key={i} className="analytics-bar-col">
              <Skeleton width="20px" height="12px" />
              <div className="analytics-bar-track">
                <Skeleton width="100%" height={`${h}%`} borderRadius="3px 3px 0 0" />
              </div>
              <Skeleton width="24px" height="12px" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsView({
  leads = [],
  deals = [],
  users = [],
  pipelines = [],
  isLoading = false,
  isGlobal = true,
  currentUser = null
}) {
  if (isLoading) {
    return <AnalyticsSkeleton isGlobal={isGlobal} />;
  }

  const [timeRange, setTimeRange] = useState('14d');
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [hoveredDay, setHoveredDay] = useState(null);
  const [selectedPipeline, setSelectedPipeline] = useState('all');
  const [selectedStagePipeline, setSelectedStagePipeline] = useState('');
  const [chartWidth, setChartWidth] = useState(700);
  const graphContainerRef = useRef(null);

  useEffect(() => {
    if (!graphContainerRef.current) return;
    const updateWidth = () => {
      if (graphContainerRef.current) {
        const w = graphContainerRef.current.clientWidth;
        if (w > 0) setChartWidth(w);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(graphContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const pipelineMap = useMemo(() => {
    const map = new Map();
    pipelines.forEach((p) => {
      if (p.id && p.name) {
        map.set(p.id, p.name);
      }
    });
    return map;
  }, [pipelines]);

  const defaultPipeline = useMemo(() => pipelines.find((p) => p.is_default), [pipelines]);
  const defaultName = defaultPipeline?.name || 'Cloud Kitchen';

  const pipelineList = useMemo(() => {
    if (pipelines && pipelines.length > 0) {
      return pipelines.map((p, idx) => ({
        id: p.id,
        name: p.name,
        color: MONO_PALETTE[idx % MONO_PALETTE.length] || '#0f172a'
      }));
    }
    return [
      { id: 'cloud_kitchen', name: 'Cloud Kitchen', color: '#0f172a' },
      { id: 'kiosk', name: 'KiosK', color: '#94a3b8' }
    ];
  }, [pipelines]);

  const currentStagePipelineName = selectedStagePipeline || defaultName;

  // Currency Formatter
  const formatCurrency = (val) => {
    if (!val || isNaN(val) || val === 0) return '₹0';
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)} L`;
    return `₹${Number(val).toLocaleString('en-IN')}`;
  };

  // 1. "Leads generated" Data (Strictly by pipelines — includes all pipelines)
  const leadsGeneratedData = useMemo(() => {
    const counts = {};
    if (pipelineList.length > 0) {
      pipelineList.forEach((p) => {
        counts[p.name] = 0;
      });
    } else {
      counts['Cloud Kitchen'] = 0;
      counts['KiosK'] = 0;
    }

    leads.forEach((l) => {
      const pName = pipelineMap.get(l.pipeline_id) || defaultName;
      counts[pName] = (counts[pName] || 0) + 1;
    });

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], index) => ({
        name,
        value: count,
        formattedValue: String(count),
        color: count === 0 ? '#cbd5e1' : MONO_PALETTE[index % MONO_PALETTE.length]
      }));
  }, [leads, pipelineList, pipelineMap, defaultName]);

  // 2. "Revenue share" Data (Strictly from deals table — 0 deals returns empty [])
  const revenueShareData = useMemo(() => {
    if (deals.length === 0) return [];

    const stageMap = {};
    deals.forEach((d) => {
      const stage = d.stage || 'Discovery';
      stageMap[stage] = (stageMap[stage] || 0) + (Number(d.value) || 0);
    });

    const entries = Object.entries(stageMap).filter(([_, val]) => val > 0);
    if (entries.length === 0) return [];

    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([name, val], idx) => ({
        name,
        value: val,
        formattedValue: formatCurrency(val),
        color: MONO_PALETTE[idx % MONO_PALETTE.length]
      }));
  }, [deals]);

  // 3. "Pipeline distribution" Data (Real stages for the selected pipeline)
  const pipelineDistributionData = useMemo(() => {
    const targetPipe =
      pipelines.find((p) => p.name === currentStagePipelineName) ||
      defaultPipeline ||
      pipelines[0];

    if (!targetPipe) return [];

    // Filter leads belonging to this pipeline
    const pipeLeads = leads.filter((l) => {
      const pId = l.pipeline_id || l.pipelineId;
      const pName = pipelineMap.get(pId) || defaultName;
      return pName === targetPipe.name || pId === targetPipe.id;
    });

    if (pipeLeads.length === 0) return [];

    const rawStages =
      Array.isArray(targetPipe.stages) && targetPipe.stages.length > 0
        ? targetPipe.stages
        : [
            { id: 'new', label: 'New Leads', order: 0 },
            { id: 'contacted', label: 'Contacted', order: 1 },
            { id: 'proposal', label: 'Proposal Sent', order: 2 },
            { id: 'won', label: 'Won', order: 3 },
            { id: 'lost', label: 'Lost', order: 4 }
          ];

    const sortedStages = [...rawStages].sort(
      (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
    );

    const stageCounts = {};
    const stageLabels = new Map();

    sortedStages.forEach((st, idx) => {
      const key = String(st.id || `stage_${idx}`).toLowerCase().trim();
      const label = st.label || st.id || `Stage ${idx + 1}`;
      stageLabels.set(key, label);
      stageCounts[key] = 0;
    });

    pipeLeads.forEach((l) => {
      const leadStage = String(l.stage || '').toLowerCase().trim();
      if (!leadStage) {
        const firstKey = sortedStages[0] ? String(sortedStages[0].id || '').toLowerCase().trim() : 'new';
        stageCounts[firstKey] = (stageCounts[firstKey] || 0) + 1;
        return;
      }

      let matchedKey = null;
      for (const st of sortedStages) {
        const sId = String(st.id || '').toLowerCase().trim();
        const sLabel = String(st.label || '').toLowerCase().trim();
        if (
          leadStage === sId ||
          leadStage === sLabel ||
          (sId === 'new' && (leadStage === 'new' || leadStage === 'new leads')) ||
          (sId === 'won' && (leadStage === 'won' || leadStage === 'closed won')) ||
          (sId === 'lost' && (leadStage === 'lost' || leadStage === 'closed lost'))
        ) {
          matchedKey = sId;
          break;
        }
      }

      if (matchedKey) {
        stageCounts[matchedKey] = (stageCounts[matchedKey] || 0) + 1;
      } else {
        const prettyName = leadStage
          .replace(/_/g, ' ')
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        stageCounts[prettyName] = (stageCounts[prettyName] || 0) + 1;
        stageLabels.set(prettyName, prettyName);
      }
    });

    const STAGE_PALETTE = ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0'];

    return Object.entries(stageCounts)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count], idx) => ({
        name: stageLabels.get(key) || key,
        value: count,
        formattedValue: String(count),
        color: STAGE_PALETTE[idx % STAGE_PALETTE.length]
      }));
  }, [pipelines, currentStagePipelineName, defaultPipeline, leads, pipelineMap, defaultName]);

  // Stage pipeline dropdown selector for "Pipeline distribution" header
  const stagePipelineSelect = (
    <div className="analytics-select-wrapper">
      <select
        className="analytics-pipeline-select"
        value={currentStagePipelineName}
        onChange={(e) => setSelectedStagePipeline(e.target.value)}
        aria-label="Filter stages by pipeline"
      >
        {pipelineList.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="analytics-select-chevron" />
    </div>
  );

  // 4. "Team allocation" Data (Real assignees from Supabase)
  const teamAllocationData = useMemo(() => {
    if (leads.length === 0) return [];
    const repCounts = {};
    leads.forEach((l) => {
      const rep = (l.assigned_to || l.assignedTo || 'Unassigned').trim();
      repCounts[rep] = (repCounts[rep] || 0) + 1;
    });

    return Object.entries(repCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], idx) => ({
        name,
        value: count,
        formattedValue: String(count),
        color: MONO_PALETTE[idx % MONO_PALETTE.length]
      }));
  }, [leads]);

  // 5. Inflow by Day of Week filtered by selectedPipeline ('all' by default)
  const dayOfWeekData = useMemo(() => {
    const days = [
      { key: 'Mon', full: 'Monday' },
      { key: 'Tue', full: 'Tuesday' },
      { key: 'Wed', full: 'Wednesday' },
      { key: 'Thu', full: 'Thursday' },
      { key: 'Fri', full: 'Friday' },
      { key: 'Sat', full: 'Saturday' },
      { key: 'Sun', full: 'Sunday' }
    ];

    const filteredLeads = leads.filter((l) => {
      if (selectedPipeline === 'all') return true;
      const pName = pipelineMap.get(l.pipeline_id) || defaultName;
      return pName === selectedPipeline;
    });

    const counts = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    filteredLeads.forEach((l) => {
      if (!l.created_at) return;
      const d = new Date(l.created_at);
      const dayIndex = (d.getDay() + 6) % 7; // Monday = 0
      counts[days[dayIndex].key]++;
    });

    const totalInflow = Object.values(counts).reduce((a, b) => a + b, 0);
    const maxVal = Math.max(...Object.values(counts), 1);

    return {
      totalInflow,
      days: days.map((d) => ({
        day: d.key,
        fullDay: d.full,
        count: counts[d.key],
        pct: Math.round((counts[d.key] / maxVal) * 100),
        sharePct: totalInflow > 0 ? Math.round((counts[d.key] / totalInflow) * 100) : 0
      }))
    };
  }, [leads, selectedPipeline, pipelineMap, defaultName]);

  // Summary Metrics strictly from real data
  const totalLeads = leads.length;

  const totalPipelineValue = useMemo(() => {
    return deals.reduce((acc, d) => acc + (Number(d.value) || 0), 0);
  }, [deals]);

  const wonDealsCount = useMemo(() => {
    return deals.filter((d) => (d.stage || '').toLowerCase() === 'closed won').length;
  }, [deals]);

  const winRate = deals.length > 0 ? Math.round((wonDealsCount / deals.length) * 100) : 0;

  const activeRepsCount = useMemo(() => {
    const assignees = new Set();
    leads.forEach((l) => {
      const a = (l.assigned_to || l.assignedTo || '').trim();
      if (a && a !== 'unassigned') assignees.add(a.toLowerCase());
    });
    return Math.max(assignees.size, users.length > 0 ? users.length : 1);
  }, [leads, users]);

  // 6. Lead Acquisition Trend (Curved Area Graph with real dates)
  const timelineData = useMemo(() => {
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 14;
    const now = new Date();
    const buckets = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      buckets.push({ date: key, label, count: 0 });
    }

    const bucketMap = new Map();
    buckets.forEach((b) => bucketMap.set(b.date, b));

    leads.forEach((lead) => {
      if (!lead.created_at) return;
      const leadDate = new Date(lead.created_at).toISOString().split('T')[0];
      if (bucketMap.has(leadDate)) {
        bucketMap.get(leadDate).count += 1;
      }
    });

    return buckets;
  }, [leads, timeRange]);

  const chartHeight = 150;
  const maxTimelineCount = useMemo(() => {
    const max = Math.max(...timelineData.map((d) => d.count), 4);
    return Math.ceil(max * 1.25);
  }, [timelineData]);

  const points = useMemo(() => {
    const n = timelineData.length;
    if (n === 0) return [];
    return timelineData.map((d, index) => {
      const x = (index / (n - 1 || 1)) * (chartWidth - 40) + 20;
      const y = chartHeight - 24 - (d.count / maxTimelineCount) * (chartHeight - 44);
      return { x, y, count: d.count, label: d.label, date: d.date };
    });
  }, [timelineData, maxTimelineCount, chartWidth]);

  const svgPathLine = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, p, i, arr) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = arr[i - 1];
      const cx = (prev.x + p.x) / 2;
      return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
    }, '');
  }, [points]);

  const svgPathArea = useMemo(() => {
    if (points.length === 0) return '';
    const first = points[0];
    const last = points[points.length - 1];
    const baseline = chartHeight - 20;
    return `${svgPathLine} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
  }, [svgPathLine, points, chartHeight]);

  // Lead Acquisition Area Graph Section
  const areaGraphSection = (
    <div className="analytics-visual-card">
      <div className="analytics-card-header">
        <div className="analytics-card-title-group">
          <h3 className="analytics-card-title">Lead acquisition volume</h3>
        </div>

        <div className="analytics-range-switcher">
          {['7d', '14d', '30d'].map((rng) => (
            <button
              key={rng}
              type="button"
              className={`analytics-range-btn ${timeRange === rng ? 'active' : ''}`}
              onClick={() => setTimeRange(rng)}
            >
              {rng.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div ref={graphContainerRef} className="analytics-graph-container" style={{ position: 'relative' }}>
        {/* Floating Tooltip for Trend Point */}
        {hoveredPoint && (
          <div
            className="analytics-graph-hover-tooltip"
            style={{
              left: `${(hoveredPoint.x / chartWidth) * 100}%`,
              top: `${hoveredPoint.y - 36}px`
            }}
          >
            <span className="tooltip-date">{hoveredPoint.label}</span>
            <span className="tooltip-count">{hoveredPoint.count} leads</span>
          </div>
        )}

        <svg
          className="analytics-svg-graph"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          width="100%"
          height={chartHeight}
        >
          <defs>
            <linearGradient id="monochromeAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f172a" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid horizontal guidelines */}
          <line x1="20" y1="20" x2={chartWidth - 20} y2="20" stroke="#e2e8f0" strokeDasharray="3 3" />
          <line x1="20" y1="65" x2={chartWidth - 20} y2="65" stroke="#e2e8f0" strokeDasharray="3 3" />
          <line x1="20" y1="110" x2={chartWidth - 20} y2="110" stroke="#e2e8f0" strokeDasharray="3 3" />
          <line x1="20" y1={chartHeight - 20} x2={chartWidth - 20} y2={chartHeight - 20} stroke="#cbd5e1" />

          {/* Area Fill */}
          {svgPathArea && <path d={svgPathArea} fill="url(#monochromeAreaGrad)" />}

          {/* Main Trend Line */}
          {svgPathLine && (
            <path
              d={svgPathLine}
              fill="none"
              stroke="#0f172a"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Interactive Vertical Cursor Line */}
          {hoveredPoint && (
            <line
              x1={hoveredPoint.x}
              y1={20}
              x2={hoveredPoint.x}
              y2={chartHeight - 20}
              stroke="#0f172a"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {/* Data Points */}
          {points.map((pt, i) => {
            const isHovered = hoveredPoint && hoveredPoint.x === pt.x;
            return (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r={isHovered ? 6 : 3.5}
                fill={isHovered ? '#0f172a' : '#ffffff'}
                stroke={isHovered ? '#ffffff' : '#0f172a'}
                strokeWidth={isHovered ? 2.5 : 2}
                style={{ transition: 'all 0.15s ease', pointerEvents: 'none' }}
              />
            );
          })}

          {/* Invisible Hitbox Columns for Smooth Hover */}
          {points.map((pt, i) => {
            const prevX = i > 0 ? (points[i - 1].x + pt.x) / 2 : 0;
            const nextX = i < points.length - 1 ? (points[i + 1].x + pt.x) / 2 : chartWidth;
            const colWidth = nextX - prevX;
            return (
              <rect
                key={`hitbox-${i}`}
                x={prevX}
                y={0}
                width={colWidth}
                height={chartHeight}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredPoint(pt)}
                onMouseLeave={() => setHoveredPoint(null)}
              />
            );
          })}
        </svg>

        {/* Timeline Date Markers */}
        <div className="analytics-graph-labels">
          {points.map((pt, i) => {
            const isHovered = hoveredPoint && hoveredPoint.x === pt.x;
            const show =
              isHovered ||
              (timeRange === '7d'
                ? true
                : timeRange === '14d'
                ? i % 2 === 0
                : i % 5 === 0 || i === points.length - 1);
            return (
              <span
                key={i}
                className={`analytics-axis-label ${isHovered ? 'active' : ''}`}
                style={{
                  left: `${(pt.x / chartWidth) * 100}%`,
                  visibility: show ? 'visible' : 'hidden',
                  fontWeight: isHovered ? 700 : 500,
                  color: isHovered ? '#0f172a' : '#94a3b8'
                }}
              >
                {pt.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );

  // Day of Week Column Chart Section
  const dayOfWeekSection = (
    <div className="analytics-visual-card">
      <div className="analytics-card-header">
        <div className="analytics-card-title-group">
          <h3 className="analytics-card-title">Lead inflow by day of week</h3>
        </div>
        <div className="analytics-select-wrapper">
          <select
            className="analytics-pipeline-select"
            value={selectedPipeline}
            onChange={(e) => setSelectedPipeline(e.target.value)}
            aria-label="Filter lead inflow by pipeline"
          >
            <option value="all">All</option>
            {pipelineList.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="analytics-select-chevron" />
        </div>
      </div>

      <div className="analytics-columns-chart-container">
        {dayOfWeekData.days.map((item) => {
          const isHovered = hoveredDay === item.day;

          return (
            <div
              key={item.day}
              className={`analytics-bar-col ${isHovered ? 'hovered' : ''}`}
              onMouseEnter={() => setHoveredDay(item.day)}
              onMouseLeave={() => setHoveredDay(null)}
            >
              {/* Floating detail tag on hover */}
              {isHovered && (
                <div className="analytics-bar-floating-tag">
                  {item.fullDay}: {item.count} leads {dayOfWeekData.totalInflow > 0 ? `(${item.sharePct}%)` : ''}
                </div>
              )}

              {!isHovered && (
                <span className="analytics-bar-count-label">{item.count}</span>
              )}

              <div className="analytics-bar-track">
                <div
                  className="analytics-bar-fill"
                  style={{
                    height: `${Math.max(item.pct, item.count > 0 ? 6 : 0)}%`,
                    backgroundColor: isHovered
                      ? '#0f172a'
                      : item.count > 0
                      ? '#334155'
                      : '#cbd5e1'
                  }}
                />
              </div>

              <span className={`analytics-bar-day-label ${isHovered ? 'active' : ''}`}>
                {item.day}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  // User / Rep Scoped Layout (When isGlobal is false)
  if (!isGlobal) {
    return (
      <div className="analytics-view-wrapper">
        {/* Row 1: Hero Area Graph (Lead acquisition volume directly on top) */}
        {areaGraphSection}

        {/* Row 2: Clean 2-card row (Leads generated & Pipeline distribution) */}
        <div className="analytics-split-grid">
          <CalloutCircleChart
            title="Leads generated"
            data={leadsGeneratedData}
            isDonut={false}
          />

          <CalloutCircleChart
            title="Pipeline distribution"
            data={pipelineDistributionData}
            isDonut={false}
            headerAction={stagePipelineSelect}
            showHoverLegendOnly={true}
            emptyMessage="No leads in this pipeline yet"
          />
        </div>

        {/* Row 3: Lead inflow by day of week */}
        {dayOfWeekSection}
      </div>
    );
  }

  // Admin / Company-wide Layout (When isGlobal is true)
  return (
    <div className="analytics-view-wrapper">
      {/* 4 Spacious Key Metric Cards */}
      <div className="analytics-metrics-grid">
        <div className="analytics-metric-tile">
          <div className="analytics-metric-label">Total Leads</div>
          <div className="analytics-metric-number">{totalLeads}</div>
        </div>

        <div className="analytics-metric-tile">
          <div className="analytics-metric-label">Pipeline Value</div>
          <div className="analytics-metric-number">{formatCurrency(totalPipelineValue)}</div>
        </div>

        <div className="analytics-metric-tile">
          <div className="analytics-metric-label">Win Rate</div>
          <div className="analytics-metric-number">{winRate}%</div>
        </div>

        <div className="analytics-metric-tile">
          <div className="analytics-metric-label">Active Reps</div>
          <div className="analytics-metric-number">{activeRepsCount}</div>
        </div>
      </div>

      {/* Row 1 of Visual Charts: Leads Generated (Solid Pie) & Revenue Share (Donut Ring) */}
      <div className="analytics-split-grid">
        <CalloutCircleChart
          title="Leads generated"
          data={leadsGeneratedData}
          isDonut={false}
        />

        <CalloutCircleChart
          title="Revenue share"
          data={revenueShareData}
          isDonut={true}
        />
      </div>

      {/* Row 2 of Visual Charts: Pipeline Distribution (Pie) & Team Allocation (Donut) */}
      <div className="analytics-split-grid">
        <CalloutCircleChart
          title="Pipeline distribution"
          data={pipelineDistributionData}
          isDonut={false}
          headerAction={stagePipelineSelect}
          showHoverLegendOnly={true}
          emptyMessage="No leads in this pipeline yet"
        />

        <CalloutCircleChart
          title="Team allocation"
          data={teamAllocationData}
          isDonut={true}
        />
      </div>

      {/* Row 3: Lead Acquisition Trend (Curved Area Graph with Interactive Hover) */}
      {areaGraphSection}

      {/* Row 4: Vertical Column Bar Chart for Days of the Week with Simple Pipeline Dropdown */}
      {dayOfWeekSection}
    </div>
  );
}
