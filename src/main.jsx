import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertCircle,
  BarChart3,
  Check,
  Download,
  FileSpreadsheet,
  LineChart,
  RotateCcw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DEFAULT_COLUMNS, parseLogFile, toNumber } from './parser.js';
import './styles.css';

const COLORS = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#d97706', '#0891b2', '#be123c', '#4f46e5'];
const CHART_NOTE = '空值或 N/A 資料會以斷線顯示';
const EXPORT_POINT_LIMIT = 1800;
const PINNED_TOOLTIP_GAP = 10;
const STATUS_EMPTY_VALUES = new Set(['', 'n/a', 'na', 'nan', 'null', 'undefined', '-']);
const TOOLTIP_LABELS = {
  '1:TGP (W)': 'GPU TGP (W)',
  'CPU TDP (W)': 'CPU TDP (W)',
  '1:TPP Measured (W)': 'TPP (W)',
  '1:Temperature GPU (C)': 'GPU Temp (C)',
  'CPU Temperature (C)': 'CPU Temp (C)',
  '1:P-State': 'P-State',
  '1:Capping Reason': 'Cap Reason',
  'CPU PROCHOT Asserted': 'PROCHOT',
  'CPU Thermal Throttling': 'Thermal Throttle',
  'Power-Package Power(Watts)': 'Package Power (Watts)',
  'Power-IA Power(Watts)': 'IA Power (Watts)',
  'Power-GT Power(Watts)': 'GT Power (Watts)',
  'Power-MSR Psys Power(Watts)': 'Psys Power (Watts)',
  'Miscellaneous-MSR Package Temperature(Degree C)': 'Package Temp (Degree C)',
  'Miscellaneous-MMIO Package Temperature(Degree C)': 'MMIO Temp (Degree C)',
  'CPU-Info-P-Core Average Frequency(MHz)': 'P-Core Avg Freq (MHz)',
  'CPU-Info-E-Core Average Frequency(MHz)': 'E-Core Avg Freq (MHz)',
  'Turbo Parameters-IA Clip Reason': 'IA Clip',
  'Turbo Parameters-Gt Clip Reason': 'GT Clip',
  'Turbo Parameters-IA Thermal Status': 'IA Thermal',
  'Turbo Parameters-GT Thermal Status': 'GT Thermal',
  'PCH-Throttling Level': 'PCH Throttle',
};

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return Number(value).toFixed(2);
}

function formatStatusValue(value) {
  const text = String(value ?? '').trim();
  return STATUS_EMPTY_VALUES.has(text.toLowerCase()) ? '-' : text;
}

function formatTooltipLabel(column) {
  const text = String(column ?? '');
  if (TOOLTIP_LABELS[text]) return TOOLTIP_LABELS[text];

  return text
    .replace(/^(Turbo Parameters|Miscellaneous|CPU-Info|Power|Gfx Component|CPU Workload)-/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isImportantStatus(column, value) {
  const text = formatStatusValue(value);
  if (text === '-') return false;
  if (column === '1:Capping Reason') return text.toLowerCase().includes('thml');
  if (column === 'CPU PROCHOT Asserted' || column === 'CPU Thermal Throttling') {
    return text.toLowerCase() === 'yes';
  }
  if (column.endsWith(' Clip Reason')) return text.toLowerCase() !== 'not clipped';
  if (column.endsWith(' Thermal Status')) return text.toLowerCase() !== 'none';
  if (column === 'Miscellaneous-IsPkgTempGreaterThanTjMax') {
    return ['1', 'yes', 'true'].includes(text.toLowerCase());
  }
  return false;
}

function clampRange(start, end, rowCount) {
  if (rowCount <= 0) return { start: 1, end: 0 };

  const safeStart = Number.isFinite(start) ? Math.trunc(start) : 1;
  const safeEnd = Number.isFinite(end) ? Math.trunc(end) : rowCount;
  const clampedStart = Math.min(Math.max(safeStart, 1), rowCount);
  const clampedEnd = Math.min(Math.max(safeEnd, clampedStart), rowCount);

  return { start: clampedStart, end: clampedEnd };
}

function buildStats(rows, selectedColumns) {
  return selectedColumns.map((column) => {
    const values = rows.map((row) => toNumber(row[column])).filter((value) => value !== null);
    if (values.length === 0) return { column, count: 0, min: null, max: null, avg: null };

    const totals = values.reduce(
      (result, value) => ({
        min: Math.min(result.min, value),
        max: Math.max(result.max, value),
        sum: result.sum + value,
      }),
      { min: values[0], max: values[0], sum: 0 },
    );

    return {
      column,
      count: values.length,
      min: totals.min,
      max: totals.max,
      avg: totals.sum / values.length,
    };
  });
}

function buildChartData(rows, selectedColumns, statusColumns, xKey, rangeStart) {
  return rows.map((row, index) => {
    const point = {
      xLabel: row[xKey] || String(rangeStart + index),
      rowIndex: rangeStart + index,
    };

    selectedColumns.forEach((column) => {
      point[column] = toNumber(row[column]);
    });

    statusColumns.forEach((column) => {
      point[column] = formatStatusValue(row[column]);
    });

    return point;
  });
}

function selectInputText(event) {
  event.currentTarget.select();
}

function orderSelectedFirst(columns, selectedColumns) {
  return [...columns].sort((left, right) => {
    const leftIndex = selectedColumns.indexOf(left);
    const rightIndex = selectedColumns.indexOf(right);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return 0;
  });
}

function buildTooltipRows(columns, point) {
  return columns
    .map((column, index) => ({
      color: COLORS[index % COLORS.length],
      column,
      label: formatTooltipLabel(column),
      value: point?.[column],
    }))
    .sort((left, right) => {
      const leftNumber = typeof left.value === 'number' && Number.isFinite(left.value);
      const rightNumber = typeof right.value === 'number' && Number.isFinite(right.value);
      if (leftNumber && rightNumber) return right.value - left.value;
      if (leftNumber) return -1;
      if (rightNumber) return 1;
      return 0;
    });
}

function buildStatusRows(statusColumns, point) {
  return statusColumns.map((column) => ({
    column,
    isImportant: isImportantStatus(column, point?.[column]),
    label: formatTooltipLabel(column),
    value: formatStatusValue(point?.[column]),
  }));
}

function ChartTooltip({ label, payload, statusColumns = [] }) {
  if (!payload?.length) return null;
  const point = payload[0]?.payload;
  const sortedPayload = [...payload].sort((left, right) => {
    const leftNumber = typeof left.value === 'number' && Number.isFinite(left.value);
    const rightNumber = typeof right.value === 'number' && Number.isFinite(right.value);
    if (leftNumber && rightNumber) return right.value - left.value;
    if (leftNumber) return -1;
    if (rightNumber) return 1;
    return 0;
  });

  return (
    <div className="recharts-custom-tooltip">
      <div className="recharts-custom-tooltip-title">列 / 時間：{label}</div>
      <div className="recharts-custom-tooltip-list">
        {sortedPayload.map((item) => (
          <div className="recharts-custom-tooltip-row" key={item.dataKey} style={{ color: item.color }}>
            {formatTooltipLabel(item.name || item.dataKey)} : {formatNumber(item.value)}
          </div>
        ))}
      </div>
      {statusColumns.length > 0 && (
        <div className="tooltip-status-list">
          {buildStatusRows(statusColumns, point).map((item) => (
            <div className={`tooltip-status-row ${item.isImportant ? 'important' : ''}`} key={item.column}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function sanitizeFileName(value) {
  const clean = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  return clean || 'chart';
}

function drawRoundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function buildExportSeries(points, maxPoints) {
  if (points.length <= maxPoints) return points;

  const bucketSize = Math.ceil(points.length / maxPoints);
  const series = [];
  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize);
    const values = bucket.map((point) => point.value).filter((value) => typeof value === 'number');
    if (values.length === 0) {
      series.push({ index: bucket[Math.floor(bucket.length / 2)].index, value: null });
      continue;
    }

    series.push({
      index: bucket[Math.floor(bucket.length / 2)].index,
      value: values.reduce((total, value) => total + value, 0) / values.length,
    });
  }
  return series;
}

function downloadChartImage({ chartData, columns, fileName, pinnedIndex, title }) {
  if (columns.length === 0 || chartData.length === 0) return;

  const width = 1200;
  const height = 720;
  const scale = Math.max(1, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  context.scale(scale, scale);

  const values = columns.flatMap((column) =>
    chartData.map((point) => point[column]).filter((value) => typeof value === 'number' && Number.isFinite(value)),
  );

  if (values.length === 0) return;

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const yMin = minValue - range * 0.08;
  const yMax = maxValue + range * 0.08;
  const plot = { left: 86, top: 108, right: 36, bottom: 126 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#0f172a';
  context.font = '700 26px "Noto Sans TC", "Microsoft JhengHei", Arial, sans-serif';
  context.fillText(title, 36, 46);
  context.fillStyle = '#64748b';
  context.font = '14px "Noto Sans TC", "Microsoft JhengHei", Arial, sans-serif';
  context.fillText(CHART_NOTE, 36, 74);

  context.strokeStyle = '#d9e2ef';
  context.lineWidth = 1;
  context.font = '13px Arial, sans-serif';
  context.fillStyle = '#64748b';
  for (let index = 0; index <= 5; index += 1) {
    const y = plot.top + (plotHeight / 5) * index;
    const value = yMax - ((yMax - yMin) / 5) * index;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(width - plot.right, y);
    context.stroke();
    context.fillText(formatNumber(value), 28, y + 4);
  }

  const tickCount = Math.min(5, chartData.length);
  for (let index = 0; index < tickCount; index += 1) {
    const dataIndex = tickCount === 1 ? 0 : Math.round((chartData.length - 1) * (index / (tickCount - 1)));
    const x = plot.left + (plotWidth / Math.max(1, chartData.length - 1)) * dataIndex;
    context.beginPath();
    context.moveTo(x, plot.top);
    context.lineTo(x, plot.top + plotHeight);
    context.stroke();
    const label = String(chartData[dataIndex]?.xLabel ?? dataIndex + 1);
    context.fillText(label, Math.min(x, width - plot.right - 160), plot.top + plotHeight + 28);
  }

  context.strokeStyle = '#94a3b8';
  context.beginPath();
  context.moveTo(plot.left, plot.top);
  context.lineTo(plot.left, plot.top + plotHeight);
  context.lineTo(width - plot.right, plot.top + plotHeight);
  context.stroke();

  columns.forEach((column, columnIndex) => {
    context.strokeStyle = COLORS[columnIndex % COLORS.length];
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.lineWidth = 2;
    let hasActiveLine = false;
    const exportSeries = buildExportSeries(
      chartData.map((point, index) => ({ index, value: point[column] })),
      EXPORT_POINT_LIMIT,
    );

    exportSeries.forEach((point) => {
      const value = point.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        if (hasActiveLine) {
          context.stroke();
          hasActiveLine = false;
        }
        return;
      }

      const x = plot.left + (plotWidth / Math.max(1, chartData.length - 1)) * point.index;
      const y = plot.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;

      if (!hasActiveLine) {
        context.beginPath();
        context.moveTo(x, y);
        hasActiveLine = true;
      } else {
        context.lineTo(x, y);
      }
    });

    if (hasActiveLine) context.stroke();
  });

  const pinnedPoint = Number.isInteger(pinnedIndex) ? chartData[pinnedIndex] : null;
  if (pinnedPoint) {
    const pinnedX = plot.left + (plotWidth / Math.max(1, chartData.length - 1)) * pinnedIndex;
    const pinnedValues = buildTooltipRows(columns, pinnedPoint).filter(
      (item) => typeof item.value === 'number' && Number.isFinite(item.value),
    );
    const pinnedYs = pinnedValues.map(
      (item) => plot.top + plotHeight - ((item.value - yMin) / (yMax - yMin)) * plotHeight,
    );

    context.strokeStyle = '#c9cdd3';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(pinnedX, plot.top);
    context.lineTo(pinnedX, plot.top + plotHeight);
    context.stroke();

    pinnedValues.forEach((item, index) => {
      context.fillStyle = item.color;
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(pinnedX, pinnedYs[index], 6, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });

    const tooltipWidth = 330;
    const tooltipHeight = 44 + pinnedValues.length * 24;
    const averageY =
      pinnedYs.length > 0 ? pinnedYs.reduce((total, y) => total + y, 0) / pinnedYs.length : plot.top + plotHeight / 2;
    const tooltipX =
      pinnedX > width / 2
        ? Math.max(plot.left + 8, pinnedX - tooltipWidth - 28)
        : Math.min(width - plot.right - tooltipWidth - 8, pinnedX + 28);
    const tooltipY = Math.min(
      Math.max(plot.top + 8, averageY - tooltipHeight / 2),
      plot.top + plotHeight - tooltipHeight - 8,
    );

    context.save();
    context.shadowColor = 'rgba(15, 23, 42, 0.14)';
    context.shadowBlur = 18;
    context.shadowOffsetY = 8;
    context.fillStyle = 'rgba(255, 255, 255, 0.98)';
    drawRoundRect(context, tooltipX, tooltipY, tooltipWidth, tooltipHeight, 8);
    context.fill();
    context.restore();

    context.strokeStyle = '#d8dce2';
    context.lineWidth = 1;
    drawRoundRect(context, tooltipX, tooltipY, tooltipWidth, tooltipHeight, 8);
    context.stroke();

    context.fillStyle = '#1f2937';
    context.font = '700 15px "Noto Sans TC", "Microsoft JhengHei", Arial, sans-serif';
    context.fillText(`列 / 時間：${pinnedPoint.xLabel}`, tooltipX + 12, tooltipY + 24);
    context.font = '700 14px "Noto Sans TC", "Microsoft JhengHei", Arial, sans-serif';
    pinnedValues.forEach((item, index) => {
      context.fillStyle = item.color;
      context.fillText(`${item.label} : ${formatNumber(item.value)}`, tooltipX + 12, tooltipY + 50 + index * 24);
    });
  }

  let legendX = plot.left;
  let legendY = height - 66;
  context.font = '15px Arial, sans-serif';
  columns.forEach((column, index) => {
    const labelWidth = context.measureText(column).width + 34;
    if (legendX + labelWidth > width - plot.right) {
      legendX = plot.left;
      legendY += 24;
    }
    context.fillStyle = COLORS[index % COLORS.length];
    context.fillRect(legendX, legendY - 9, 18, 3);
    context.fillText(column, legendX + 26, legendY);
    legendX += labelWidth + 18;
  });

  const link = document.createElement('a');
  link.download = `${sanitizeFileName(fileName || title)}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function ColumnSelector({
  columns,
  defaultColumns,
  emptyText,
  filteredColumns,
  onSearchChange,
  onToggleColumn,
  search,
  selectedColumns,
  subtitle,
  title,
}) {
  const listRef = useRef(null);
  const pendingScrollRef = useRef(null);
  const displayedColumns = orderSelectedFirst(filteredColumns, selectedColumns);

  useLayoutEffect(() => {
    const pendingScroll = pendingScrollRef.current;
    if (!pendingScroll) return;

    if (listRef.current) {
      listRef.current.scrollTop = pendingScroll.listTop;
      listRef.current.scrollLeft = pendingScroll.listLeft;
    }
    window.scrollTo(pendingScroll.windowX, pendingScroll.windowY);
    pendingScrollRef.current = null;
  }, [displayedColumns]);

  function handleToggleColumn(column) {
    pendingScrollRef.current = {
      listLeft: listRef.current?.scrollLeft || 0,
      listTop: listRef.current?.scrollTop || 0,
      windowX: window.scrollX,
      windowY: window.scrollY,
    };
    onToggleColumn(column);
  }

  return (
    <section className="column-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span>
          {selectedColumns.length}/{columns.length}
        </span>
      </div>
      <label className="search-box">
        <Search size={16} />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜尋欄位"
        />
      </label>
      <div className="column-list" ref={listRef}>
        {displayedColumns.length > 0 ? (
          displayedColumns.map((column) => {
            const checked = selectedColumns.includes(column);
            const isDefault = defaultColumns.includes(column);
            return (
              <label className={`column-option ${checked ? 'checked' : ''}`} key={column}>
                <input type="checkbox" checked={checked} onChange={() => handleToggleColumn(column)} />
                <span className="fake-checkbox">{checked && <Check size={14} />}</span>
                <span className="column-name">{column}</span>
                {isDefault && <span className="default-badge">預設</span>}
              </label>
            );
          })
        ) : (
          <div className="column-empty">{emptyText}</div>
        )}
      </div>
    </section>
  );
}

function ChartPanel({ chartData, onDownload, onTitleChange, selectedColumns, statusColumns = [], title }) {
  const chartAreaRef = useRef(null);
  const canDownload = selectedColumns.length > 0 && chartData.length > 0;
  const [pinnedTooltip, setPinnedTooltip] = useState(null);

  const pinnedPoint =
    pinnedTooltip && pinnedTooltip.index >= 0 && pinnedTooltip.index < chartData.length
      ? chartData[pinnedTooltip.index]
      : null;
  const pinnedRows = pinnedPoint ? buildTooltipRows(selectedColumns, pinnedPoint) : [];
  const pinnedStatusRows = pinnedPoint ? buildStatusRows(statusColumns, pinnedPoint) : [];
  const pinnedChartWidth = chartAreaRef.current?.clientWidth || 0;
  const pinnedTooltipStyle =
    pinnedTooltip?.placement === 'left'
      ? {
          right: Math.max(PINNED_TOOLTIP_GAP, pinnedChartWidth - pinnedTooltip.anchor.x + PINNED_TOOLTIP_GAP),
          top: pinnedTooltip.anchor.y,
        }
      : pinnedTooltip
        ? {
            left: pinnedTooltip.anchor.x + PINNED_TOOLTIP_GAP,
            top: pinnedTooltip.anchor.y,
          }
        : undefined;

  function handleChartClick(event) {
    if (!event || typeof event.activeTooltipIndex !== 'number' || !event.activeCoordinate) return;

    const chartArea = chartAreaRef.current;
    const chartAreaRect = chartArea?.getBoundingClientRect();
    const wrapperRect = chartArea?.querySelector('.recharts-wrapper')?.getBoundingClientRect();
    const wrapperOffsetX = chartAreaRect && wrapperRect ? wrapperRect.left - chartAreaRect.left : 0;
    const wrapperOffsetY = chartAreaRect && wrapperRect ? wrapperRect.top - chartAreaRect.top : 0;
    const wrapperWidth = wrapperRect?.width || chartArea?.clientWidth || 0;
    const anchor = {
      x: wrapperOffsetX + event.activeCoordinate.x,
      y: wrapperOffsetY + event.activeCoordinate.y,
    };

    setPinnedTooltip((current) => {
      if (current?.index === event.activeTooltipIndex) return null;
      return {
        anchor,
        index: event.activeTooltipIndex,
        placement: event.activeCoordinate.x > wrapperWidth / 2 ? 'left' : 'right',
      };
    });
  }

  return (
    <section className="chart-panel">
      <div className="panel-heading">
        <div className="chart-title-group">
          <input
            aria-label="圖表標題"
            className="chart-title-input"
            type="text"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
          <p>{CHART_NOTE}</p>
        </div>
        <div className="chart-actions">
          <button
            aria-label="下載圖表"
            className="icon-button"
            type="button"
            onClick={() => onDownload(pinnedTooltip?.index)}
            disabled={!canDownload}
            title="下載圖表"
          >
            <Download size={18} />
          </button>
          <LineChart size={22} />
        </div>
      </div>
      <div className="chart-area" ref={chartAreaRef}>
        {selectedColumns.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <RechartsLineChart
              data={chartData}
              margin={{ top: 12, right: 24, bottom: 8, left: 0 }}
              onClick={handleChartClick}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#d9e2ef" />
              <XAxis dataKey="xLabel" minTickGap={42} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={58} />
              <Tooltip content={<ChartTooltip statusColumns={statusColumns} />} />
              <Legend wrapperStyle={{ paddingTop: 10 }} />
              {selectedColumns.map((column, index) => (
                <Line
                  key={column}
                  type="monotone"
                  dataKey={column}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
              {pinnedPoint && (
                <ReferenceLine x={pinnedPoint.xLabel} stroke="#c9cdd3" strokeWidth={1.5} ifOverflow="extendDomain" />
              )}
              {pinnedPoint &&
                selectedColumns.map((column, index) => {
                  const value = pinnedPoint[column];
                  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
                  return (
                    <ReferenceDot
                      key={`${column}-pinned`}
                      x={pinnedPoint.xLabel}
                      y={value}
                      r={6}
                      fill={COLORS[index % COLORS.length]}
                      stroke="#ffffff"
                      strokeWidth={2}
                      ifOverflow="extendDomain"
                    />
                  );
                })}
            </RechartsLineChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state">請選擇欄位以顯示圖表</div>
        )}
        {pinnedPoint && (
          <div
            className={`pinned-tooltip ${pinnedTooltip.placement === 'left' ? 'left' : 'right'}`}
            style={pinnedTooltipStyle}
          >
            <div className="pinned-tooltip-title">列 / 時間：{pinnedPoint.xLabel}</div>
            <div className="pinned-tooltip-list">
              {pinnedRows.map((item) => (
                <div className="pinned-tooltip-row" key={item.column} style={{ color: item.color }}>
                  {item.label} : {formatNumber(item.value)}
                </div>
              ))}
            </div>
            {pinnedStatusRows.length > 0 && (
              <div className="tooltip-status-list">
                {pinnedStatusRows.map((item) => (
                  <div className={`tooltip-status-row ${item.isImportant ? 'important' : ''}`} key={item.column}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StatusTable({ rows, statusColumns, xKey, rangeStart }) {
  if (statusColumns.length === 0) return null;

  return (
    <section className="status-panel">
      <div className="panel-heading">
        <div>
          <h2>狀態欄位明細</h2>
          <p>顯示目前範圍內每列的 P-State、Capping 與 CPU throttle 狀態</p>
        </div>
        <span>{rows.length.toLocaleString()}</span>
      </div>
      <div className="status-table-wrap">
        <table className="status-table">
          <thead>
            <tr>
              <th>Row</th>
              <th>X</th>
              {statusColumns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${rangeStart + index}-${row[xKey] || index}`}>
                <td>{(rangeStart + index).toLocaleString()}</td>
                <td>{formatStatusValue(row[xKey] || rangeStart + index)}</td>
                {statusColumns.map((column) => {
                  const value = formatStatusValue(row[column]);
                  return (
                    <td className={isImportantStatus(column, value) ? 'important-status-cell' : ''} key={column}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function App() {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [numericColumns, setNumericColumns] = useState([]);
  const [statusColumns, setStatusColumns] = useState([]);
  const [defaultColumns, setDefaultColumns] = useState(DEFAULT_COLUMNS);
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [secondaryColumns, setSecondaryColumns] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [xKey, setXKey] = useState('');
  const [xLabel, setXLabel] = useState('');
  const [rangeStartInput, setRangeStartInput] = useState('1');
  const [rangeEndInput, setRangeEndInput] = useState('');
  const [columnSearch, setColumnSearch] = useState('');
  const [secondaryColumnSearch, setSecondaryColumnSearch] = useState('');
  const [showSecondaryChart, setShowSecondaryChart] = useState(true);
  const [showTooltipStatus, setShowTooltipStatus] = useState(true);
  const [chartTitle, setChartTitle] = useState('主要功耗圖');
  const [secondaryChartTitle, setSecondaryChartTitle] = useState('次要欄位圖');

  const rowCount = rows.length;
  const range = useMemo(
    () => clampRange(Number(rangeStartInput), Number(rangeEndInput || rowCount), rowCount),
    [rangeEndInput, rangeStartInput, rowCount],
  );
  const rangedRows = useMemo(() => rows.slice(range.start - 1, range.end), [range.end, range.start, rows]);
  const stats = useMemo(() => buildStats(rangedRows, selectedColumns), [rangedRows, selectedColumns]);
  const chartData = useMemo(
    () => buildChartData(rangedRows, selectedColumns, statusColumns, xKey, range.start),
    [rangedRows, selectedColumns, statusColumns, xKey, range.start],
  );
  const secondaryChartData = useMemo(
    () => buildChartData(rangedRows, secondaryColumns, statusColumns, xKey, range.start),
    [rangedRows, secondaryColumns, statusColumns, xKey, range.start],
  );
  const filteredColumns = useMemo(() => {
    const keyword = columnSearch.trim().toLowerCase();
    if (!keyword) return numericColumns;
    return numericColumns.filter((column) => column.toLowerCase().includes(keyword));
  }, [columnSearch, numericColumns]);
  const filteredSecondaryColumns = useMemo(() => {
    const keyword = secondaryColumnSearch.trim().toLowerCase();
    if (!keyword) return numericColumns;
    return numericColumns.filter((column) => column.toLowerCase().includes(keyword));
  }, [secondaryColumnSearch, numericColumns]);

  const hasData = rowCount > 0;
  const rangeText = hasData ? `${range.start.toLocaleString()} - ${range.end.toLocaleString()}` : '-';

  async function loadFile(file) {
    if (!file) return;

    setIsLoading(true);
    setError('');
    setWarnings([]);

    try {
      const parsed = await parseLogFile(file);
      setFileName(file.name);
      setRows(parsed.rows);
      setNumericColumns(parsed.numericColumns);
      setStatusColumns(parsed.statusColumns || []);
      setDefaultColumns(parsed.defaultColumns || DEFAULT_COLUMNS);
      setSelectedColumns(parsed.selectedColumns);
      setSecondaryColumns([]);
      setWarnings(parsed.warnings);
      setXKey(parsed.xKey);
      setXLabel(parsed.xLabel);
      setRangeStartInput('1');
      setRangeEndInput(String(parsed.rows.length));
      setColumnSearch('');
      setSecondaryColumnSearch('');
      setShowTooltipStatus(true);
      setChartTitle('主要功耗圖');
      setSecondaryChartTitle('次要欄位圖');
    } catch (err) {
      setFileName('');
      setRows([]);
      setNumericColumns([]);
      setStatusColumns([]);
      setDefaultColumns(DEFAULT_COLUMNS);
      setSelectedColumns([]);
      setSecondaryColumns([]);
      setXKey('');
      setXLabel('');
      setRangeStartInput('1');
      setRangeEndInput('');
      setColumnSearch('');
      setSecondaryColumnSearch('');
      setShowTooltipStatus(true);
      setError(err instanceof Error ? err.message : '無法讀取檔案');
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleFiles(fileList) {
    const [file] = Array.from(fileList || []);
    loadFile(file);
  }

  function toggleColumn(column) {
    setSelectedColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column],
    );
  }

  function toggleSecondaryColumn(column) {
    setSecondaryColumns((current) =>
      current.includes(column) ? current.filter((item) => item !== column) : [...current, column],
    );
  }

  function resetRange() {
    setRangeStartInput('1');
    setRangeEndInput(String(rowCount));
  }

  function clearFile() {
    setFileName('');
    setRows([]);
    setNumericColumns([]);
    setStatusColumns([]);
    setDefaultColumns(DEFAULT_COLUMNS);
    setSelectedColumns([]);
    setSecondaryColumns([]);
    setWarnings([]);
    setError('');
    setXKey('');
    setXLabel('');
    setRangeStartInput('1');
    setRangeEndInput('');
    setColumnSearch('');
    setSecondaryColumnSearch('');
    setShowTooltipStatus(true);
    setChartTitle('主要功耗圖');
    setSecondaryChartTitle('次要欄位圖');
  }

  return (
    <main className="app-shell">
      <section className="top-bar">
        <div>
          <h1>Log 檢查工具</h1>
          <p>匯入 CSV 或 Excel log，快速檢查功耗、溫度與其他數值欄位的趨勢。</p>
        </div>
        {hasData && (
          <button className="ghost-button" type="button" onClick={clearFile}>
            <X size={18} />
            清除
          </button>
        )}
      </section>

      <section
        className={`upload-zone ${isDragging ? 'dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(event) => handleFiles(event.target.files)}
        />
        <div className="upload-icon">
          <Upload size={26} />
        </div>
        <div>
          <strong>{isLoading ? '讀取中...' : '拖曳 log 檔案到這裡'}</strong>
          <span>支援 CSV、XLSX、XLS，會自動尋找表頭並分析可用的數值欄位。</span>
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          <FileSpreadsheet size={18} />
          選擇檔案
        </button>
      </section>

      {error && (
        <div className="message error">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="message warning">
          <AlertCircle size={18} />
          <div>
            {warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        </div>
      )}

      {hasData && (
        <>
          <section className="summary-strip">
            <div>
              <span>檔案</span>
              <strong>{fileName}</strong>
            </div>
            <div>
              <span>資料列數</span>
              <strong>
                {rangedRows.length.toLocaleString()} / {rowCount.toLocaleString()}
              </strong>
            </div>
            <div>
              <span>數值欄位</span>
              <strong>{numericColumns.length.toLocaleString()}</strong>
            </div>
            <div>
              <span>X 軸</span>
              <strong>{xLabel || '資料列號'}</strong>
            </div>
          </section>

          <section className="range-panel">
            <div>
              <h2>資料範圍</h2>
              <p>調整要顯示與統計的資料列，現在範圍：{rangeText}</p>
            </div>
            <div className="range-controls">
              <label>
                <span>起始列</span>
                <input
                  min="1"
                  max={rowCount}
                  type="number"
                  value={rangeStartInput}
                  onClick={selectInputText}
                  onChange={(event) => setRangeStartInput(event.target.value)}
                  onFocus={selectInputText}
                  onBlur={() => setRangeStartInput(String(range.start))}
                />
              </label>
              <label>
                <span>結束列</span>
                <input
                  min="1"
                  max={rowCount}
                  type="number"
                  value={rangeEndInput}
                  onClick={selectInputText}
                  onChange={(event) => setRangeEndInput(event.target.value)}
                  onFocus={selectInputText}
                  onBlur={() => setRangeEndInput(String(range.end))}
                />
              </label>
              <button className="secondary-button" type="button" onClick={resetRange}>
                <RotateCcw size={16} />
                重設範圍
              </button>
            </div>
          </section>

          <section className="workspace-grid">
            <aside className="column-sidebar">
              <label className="secondary-toggle">
                <input
                  type="checkbox"
                  checked={showSecondaryChart}
                  onChange={(event) => setShowSecondaryChart(event.target.checked)}
                />
                <span>顯示次要欄位與次要圖</span>
              </label>
              {statusColumns.length > 0 && (
                <label className="secondary-toggle">
                  <input
                    type="checkbox"
                    checked={showTooltipStatus}
                    onChange={(event) => setShowTooltipStatus(event.target.checked)}
                  />
                  <span>懸浮窗顯示摘要狀態</span>
                </label>
              )}
              <ColumnSelector
                columns={numericColumns}
                defaultColumns={defaultColumns}
                emptyText="找不到符合搜尋的數值欄位"
                filteredColumns={filteredColumns}
                onSearchChange={setColumnSearch}
                onToggleColumn={toggleColumn}
                search={columnSearch}
                selectedColumns={selectedColumns}
                subtitle="選擇要在主要圖表與統計卡顯示的欄位"
                title="主要欄位"
              />
              {showSecondaryChart && (
                <ColumnSelector
                  columns={numericColumns}
                  defaultColumns={defaultColumns}
                  emptyText="找不到符合搜尋的數值欄位"
                  filteredColumns={filteredSecondaryColumns}
                  onSearchChange={setSecondaryColumnSearch}
                  onToggleColumn={toggleSecondaryColumn}
                  search={secondaryColumnSearch}
                  selectedColumns={secondaryColumns}
                  subtitle="選擇要另外繪製在第二張圖的欄位"
                  title="次要欄位"
                />
              )}
            </aside>

            <section className="main-panel">
              <div className="stats-grid">
                {stats.length > 0 ? (
                  stats.map((item) => (
                    <article className="stat-card" key={item.column}>
                      <div className="stat-title">
                        <BarChart3 size={17} />
                        <h3>{item.column}</h3>
                      </div>
                      <dl>
                        <div>
                          <dt>最大值</dt>
                          <dd>{formatNumber(item.max)}</dd>
                        </div>
                        <div>
                          <dt>最小值</dt>
                          <dd>{formatNumber(item.min)}</dd>
                        </div>
                        <div>
                          <dt>平均值</dt>
                          <dd>{formatNumber(item.avg)}</dd>
                        </div>
                        <div>
                          <dt>有效筆數</dt>
                          <dd>{item.count.toLocaleString()}</dd>
                        </div>
                      </dl>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">請先選擇至少一個數值欄位</div>
                )}
              </div>

              <ChartPanel
                chartData={chartData}
                onDownload={(pinnedIndex) =>
                  downloadChartImage({
                    chartData,
                    columns: selectedColumns,
                    fileName: chartTitle,
                    pinnedIndex,
                    title: chartTitle,
                  })
                }
                onTitleChange={setChartTitle}
                selectedColumns={selectedColumns}
                statusColumns={showTooltipStatus ? statusColumns : []}
                title={chartTitle}
              />
              {showSecondaryChart && (
                <ChartPanel
                  chartData={secondaryChartData}
                  onDownload={(pinnedIndex) =>
                    downloadChartImage({
                      chartData: secondaryChartData,
                      columns: secondaryColumns,
                      fileName: secondaryChartTitle,
                      pinnedIndex,
                      title: secondaryChartTitle,
                    })
                  }
                  onTitleChange={setSecondaryChartTitle}
                  selectedColumns={secondaryColumns}
                  statusColumns={showTooltipStatus ? statusColumns : []}
                  title={secondaryChartTitle}
                />
              )}
              <StatusTable
                rows={rangedRows}
                statusColumns={statusColumns}
                xKey={xKey}
                rangeStart={range.start}
              />
            </section>
          </section>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
