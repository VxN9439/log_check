import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export const DEFAULT_COLUMNS = [
  '1:TGP (W)',
  'CPU TDP (W)',
  '1:TPP Measured (W)',
  '1:Temperature GPU (C)',
  'CPU Temperature (C)',
];

const HEADER_HINTS = ['Iteration', 'Date', 'Timestamp', ...DEFAULT_COLUMNS];
const NA_VALUES = new Set(['', 'n/a', 'na', 'nan', 'null', 'undefined', '-']);

export function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const text = String(value).trim().replace(/,/g, '');
  if (NA_VALUES.has(text.toLowerCase())) return null;

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeCell(value) {
  return String(value ?? '').trim();
}

function dedupeHeaders(headers) {
  const seen = new Map();
  return headers.map((header, index) => {
    const clean = normalizeCell(header) || `Column ${index + 1}`;
    const count = seen.get(clean) || 0;
    seen.set(clean, count + 1);
    return count === 0 ? clean : `${clean} (${count + 1})`;
  });
}

function rowScore(row) {
  const cells = row.map(normalizeCell);
  const exactHints = HEADER_HINTS.filter((hint) => cells.includes(hint)).length;
  const hasIteration = cells.includes('Iteration');
  const hasDate = cells.includes('Date');
  const hasTimestamp = cells.includes('Timestamp');
  const nonEmptyCount = cells.filter(Boolean).length;

  if (hasIteration && hasDate && hasTimestamp) return 100 + exactHints + nonEmptyCount / 100;
  if (hasIteration && exactHints >= 2) return 80 + exactHints;
  if (exactHints >= 3) return 60 + exactHints;
  return exactHints;
}

function findHeaderIndex(table) {
  let bestIndex = -1;
  let bestScore = 0;

  table.forEach((row, index) => {
    const score = rowScore(Array.isArray(row) ? row : []);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 3 ? bestIndex : -1;
}

function trimTrailingEmptyCells(row) {
  const next = [...row];
  while (next.length > 0 && normalizeCell(next[next.length - 1]) === '') {
    next.pop();
  }
  return next;
}

function tableToRows(table) {
  const cleaned = table.map((row) => trimTrailingEmptyCells(Array.isArray(row) ? row : []));
  const headerIndex = findHeaderIndex(cleaned);

  if (headerIndex < 0) {
    throw new Error('找不到資料表表頭。請確認檔案包含 Iteration、Date、Timestamp 或預設欄位。');
  }

  const headers = dedupeHeaders(cleaned[headerIndex]);
  const rows = cleaned
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => normalizeCell(cell) !== ''))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = row[index] ?? '';
      });
      return item;
    });

  if (rows.length === 0) {
    throw new Error('找到表頭，但沒有可分析的資料列。');
  }

  return { headers, rows };
}

function buildXLabels(rows) {
  if (rows.some((row) => normalizeCell(row.Date) || normalizeCell(row.Timestamp))) {
    const xKey = '__timeLabel';
    const nextRows = rows.map((row, index) => ({
      ...row,
      [xKey]: [normalizeCell(row.Date), normalizeCell(row.Timestamp)].filter(Boolean).join(' ') || String(index + 1),
    }));
    return { rows: nextRows, xKey, xLabel: 'Date + Timestamp' };
  }

  if (rows.some((row) => normalizeCell(row.Iteration))) {
    return { rows, xKey: 'Iteration', xLabel: 'Iteration' };
  }

  const xKey = '__rowNumber';
  return {
    rows: rows.map((row, index) => ({ ...row, [xKey]: String(index + 1) })),
    xKey,
    xLabel: '資料列序號',
  };
}

function getNumericColumns(headers, rows) {
  return headers.filter((header) => rows.some((row) => toNumber(row[header]) !== null));
}

function finalizeParsedTable(table) {
  const { headers, rows } = tableToRows(table);
  const { rows: rowsWithX, xKey, xLabel } = buildXLabels(rows);
  const numericColumns = getNumericColumns(headers, rowsWithX);

  if (numericColumns.length === 0) {
    throw new Error('此檔案沒有可分析的數值欄位。');
  }

  const missingDefaults = DEFAULT_COLUMNS.filter((column) => !headers.includes(column));
  const nonNumericDefaults = DEFAULT_COLUMNS.filter(
    (column) => headers.includes(column) && !numericColumns.includes(column),
  );
  const selectedColumns = DEFAULT_COLUMNS.filter((column) => numericColumns.includes(column));
  const warnings = [
    ...missingDefaults.map((column) => `此檔案未找到：${column}`),
    ...nonNumericDefaults.map((column) => `此欄位不是可分析的數值欄位：${column}`),
  ];

  return {
    headers,
    rows: rowsWithX,
    numericColumns,
    selectedColumns: selectedColumns.length > 0 ? selectedColumns : numericColumns.slice(0, 5),
    warnings,
    xKey,
    xLabel,
  };
}

async function parseCsv(file) {
  const text = await file.text();
  const parsed = Papa.parse(text, {
    skipEmptyLines: false,
    dynamicTyping: false,
  });

  if (parsed.errors?.length) {
    const fatalError = parsed.errors.find((error) => error.type !== 'Delimiter');
    if (fatalError) {
      throw new Error(`CSV 解析失敗：${fatalError.message}`);
    }
  }

  return finalizeParsedTable(parsed.data);
}

async function parseWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('Excel 檔案沒有工作表。');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const table = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    blankrows: true,
    defval: '',
  });

  return finalizeParsedTable(table);
}

export async function parseLogFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv')) {
    return parseCsv(file);
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseWorkbook(file);
  }

  throw new Error('不支援的檔案格式。請選擇 CSV、XLSX 或 XLS 檔。');
}
