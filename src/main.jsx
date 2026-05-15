import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertCircle,
  BarChart3,
  Check,
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DEFAULT_COLUMNS, parseLogFile, toNumber } from './parser.js';
import './styles.css';

const COLORS = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#d97706', '#0891b2', '#be123c', '#4f46e5'];

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return Number(value).toFixed(2);
}

function clampRange(start, end, rowCount) {
  if (rowCount <= 0) {
    return { start: 1, end: 0 };
  }

  const safeStart = Number.isFinite(start) ? Math.trunc(start) : 1;
  const safeEnd = Number.isFinite(end) ? Math.trunc(end) : rowCount;
  const clampedStart = Math.min(Math.max(safeStart, 1), rowCount);
  const clampedEnd = Math.min(Math.max(safeEnd, clampedStart), rowCount);

  return { start: clampedStart, end: clampedEnd };
}

function buildStats(rows, selectedColumns) {
  return selectedColumns.map((column) => {
    const values = rows.map((row) => toNumber(row[column])).filter((value) => value !== null);
    if (values.length === 0) {
      return { column, count: 0, min: null, max: null, avg: null };
    }

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

function buildChartData(rows, selectedColumns, xKey, rangeStart) {
  return rows.map((row, index) => {
    const point = {
      xLabel: row[xKey] || String(rangeStart + index),
      rowIndex: rangeStart + index,
    };

    selectedColumns.forEach((column) => {
      point[column] = toNumber(row[column]);
    });

    return point;
  });
}

function App() {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [numericColumns, setNumericColumns] = useState([]);
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [xKey, setXKey] = useState('');
  const [xLabel, setXLabel] = useState('');
  const [rangeStartInput, setRangeStartInput] = useState('1');
  const [rangeEndInput, setRangeEndInput] = useState('');
  const [columnSearch, setColumnSearch] = useState('');

  const rowCount = rows.length;
  const range = useMemo(
    () => clampRange(Number(rangeStartInput), Number(rangeEndInput || rowCount), rowCount),
    [rangeEndInput, rangeStartInput, rowCount],
  );
  const rangedRows = useMemo(() => rows.slice(range.start - 1, range.end), [range.end, range.start, rows]);
  const stats = useMemo(() => buildStats(rangedRows, selectedColumns), [rangedRows, selectedColumns]);
  const chartData = useMemo(
    () => buildChartData(rangedRows, selectedColumns, xKey, range.start),
    [rangedRows, selectedColumns, xKey, range.start],
  );
  const filteredColumns = useMemo(() => {
    const keyword = columnSearch.trim().toLowerCase();
    if (!keyword) return numericColumns;
    return numericColumns.filter((column) => column.toLowerCase().includes(keyword));
  }, [columnSearch, numericColumns]);

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
      setSelectedColumns(parsed.selectedColumns);
      setWarnings(parsed.warnings);
      setXKey(parsed.xKey);
      setXLabel(parsed.xLabel);
      setRangeStartInput('1');
      setRangeEndInput(String(parsed.rows.length));
      setColumnSearch('');
    } catch (err) {
      setFileName('');
      setRows([]);
      setNumericColumns([]);
      setSelectedColumns([]);
      setXKey('');
      setXLabel('');
      setRangeStartInput('1');
      setRangeEndInput('');
      setColumnSearch('');
      setError(err instanceof Error ? err.message : '無法解析檔案。');
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
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

  function resetRange() {
    setRangeStartInput('1');
    setRangeEndInput(String(rowCount));
  }

  function clearFile() {
    setFileName('');
    setRows([]);
    setNumericColumns([]);
    setSelectedColumns([]);
    setWarnings([]);
    setError('');
    setXKey('');
    setXLabel('');
    setRangeStartInput('1');
    setRangeEndInput('');
    setColumnSearch('');
  }

  return (
    <main className="app-shell">
      <section className="top-bar">
        <div>
          <h1>Log 檢查工具</h1>
          <p>載入 CSV 或 Excel 檔，選擇欄位查看最大值、最小值、平均值與折線圖。</p>
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
          <strong>{isLoading ? '解析中...' : '拖放 log 檔或選擇檔案'}</strong>
          <span>支援 CSV、XLSX、XLS。檔案只會在本機瀏覽器解析。</span>
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
              <span>資料筆數</span>
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
              <strong>{xLabel || '資料列序號'}</strong>
            </div>
          </section>

          <section className="range-panel">
            <div>
              <h2>資料範圍</h2>
              <p>統計值與折線圖只會使用指定筆數範圍。現在範圍：{rangeText}</p>
            </div>
            <div className="range-controls">
              <label>
                <span>起始筆</span>
                <input
                  min="1"
                  max={rowCount}
                  type="number"
                  value={rangeStartInput}
                  onChange={(event) => setRangeStartInput(event.target.value)}
                  onBlur={() => setRangeStartInput(String(range.start))}
                />
              </label>
              <label>
                <span>結束筆</span>
                <input
                  min="1"
                  max={rowCount}
                  type="number"
                  value={rangeEndInput}
                  onChange={(event) => setRangeEndInput(event.target.value)}
                  onBlur={() => setRangeEndInput(String(range.end))}
                />
              </label>
              <button className="secondary-button" type="button" onClick={resetRange}>
                <RotateCcw size={16} />
                全部資料
              </button>
            </div>
          </section>

          <section className="workspace-grid">
            <aside className="column-panel">
              <div className="panel-heading">
                <div>
                  <h2>欄位</h2>
                  <p>選擇要統計與繪圖的數值欄位</p>
                </div>
                <span>{selectedColumns.length}/{numericColumns.length}</span>
              </div>
              <label className="search-box">
                <Search size={16} />
                <input
                  type="search"
                  value={columnSearch}
                  onChange={(event) => setColumnSearch(event.target.value)}
                  placeholder="搜尋欄位"
                />
              </label>
              <div className="column-list">
                {filteredColumns.length > 0 ? (
                  filteredColumns.map((column) => {
                    const checked = selectedColumns.includes(column);
                    const isDefault = DEFAULT_COLUMNS.includes(column);
                    return (
                      <label className={`column-option ${checked ? 'checked' : ''}`} key={column}>
                        <input type="checkbox" checked={checked} onChange={() => toggleColumn(column)} />
                        <span className="fake-checkbox">{checked && <Check size={14} />}</span>
                        <span className="column-name">{column}</span>
                        {isDefault && <span className="default-badge">預設</span>}
                      </label>
                    );
                  })
                ) : (
                  <div className="column-empty">找不到符合搜尋的欄位。</div>
                )}
              </div>
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
                  <div className="empty-state">請從左側選擇至少一個欄位。</div>
                )}
              </div>

              <section className="chart-panel">
                <div className="panel-heading">
                  <div>
                    <h2>折線圖</h2>
                    <p>非數值、空白與 N/A 資料點會自動忽略</p>
                  </div>
                  <LineChart size={22} />
                </div>
                <div className="chart-area">
                  {selectedColumns.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsLineChart data={chartData} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d9e2ef" />
                        <XAxis dataKey="xLabel" minTickGap={42} tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} width={58} />
                        <Tooltip
                          formatter={(value) => (value == null ? '-' : formatNumber(value))}
                          labelFormatter={(label) => `時間 / 序號：${label}`}
                        />
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
                      </RechartsLineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="empty-state">選擇欄位後會顯示折線圖。</div>
                  )}
                </div>
              </section>
            </section>
          </section>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
