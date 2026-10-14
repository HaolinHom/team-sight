export const MATRIX_ROW_HEIGHT = 144;
export const MATRIX_COLUMN_WIDTH = 144;
export function matrixWindow(rows: number, columns: number, top: number, left: number, height: number, width: number) {
  const virtual = rows * columns > 2000;
  const rowStart = virtual ? Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor((top - 60) / MATRIX_ROW_HEIGHT) - 2)) : 0;
  const columnStart = virtual ? Math.min(Math.max(0, columns - 1), Math.max(0, Math.floor(left / MATRIX_COLUMN_WIDTH) - 2)) : 0;
  const rowEnd = virtual ? Math.min(rows, rowStart + Math.ceil(height / MATRIX_ROW_HEIGHT) + 5) : rows;
  const columnEnd = virtual ? Math.min(columns, columnStart + Math.ceil(width / MATRIX_COLUMN_WIDTH) + 5) : columns;
  return { virtual, rowStart, rowEnd, columnStart, columnEnd, top: rowStart * MATRIX_ROW_HEIGHT, bottom: (rows - rowEnd) * MATRIX_ROW_HEIGHT, left: columnStart * MATRIX_COLUMN_WIDTH, right: (columns - columnEnd) * MATRIX_COLUMN_WIDTH };
}
