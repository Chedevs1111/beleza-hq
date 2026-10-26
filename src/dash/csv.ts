// CSV for the Activity export (RFC 4180). A cell that begins with = + - @ tab or CR would be read as a formula by a
// spreadsheet, so it gets a leading ' first; then any cell holding a comma, quote or line break is quoted whole.

const FORMULA_LEAD = /^[=+\-@\t\r]/;

function cell(value: string): string {
  const safe = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
