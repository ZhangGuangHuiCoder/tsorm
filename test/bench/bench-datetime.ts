/** 诊断：有 datetime 的列为什么慢。造数据不计入计时，只测纯解码开销。 */
import { parseSchema, type Table, type Column } from "../../src/schema/index.js";
import { decode, storedInstant } from "../../src/shared/index.js";

const base = parseSchema("model Row {\n id: int @id @auto\n payload: string\n createdAt: datetime\n}").tables.Row;
const withDate: Table = base;
const noDate: Table = { ...base, columns: Object.fromEntries(Object.entries(base.columns).filter(([k]) => k !== "createdAt")) };
const withTs: Table = {
  ...base,
  columns: { ...base.columns, createdAt: { ...base.columns.createdAt, dateStorage: "timestamp" } as Column },
};

const N = 1_000_000;
// 重复轮数可用第一个参数指定（便于多次取中位数），默认沿用原有的单次计时。
const argRuns = Number(process.argv[2]);
const RUNS = Number.isSafeInteger(argRuns) && argRuns > 0 ? argRuns : 1;

const ISO = new Date(Date.UTC(2024, 0, 1)).toISOString();
const MS = Date.UTC(2024, 0, 1);

// 预先造好数据，全部在计时之外
const rowsISO = Array.from({ length: N }, () => ({ id: 1, payload: "x".repeat(40), createdAt: ISO }));
const rowsNull = Array.from({ length: N }, () => ({ id: 1, payload: "x".repeat(40), createdAt: null }));
const rowsDate = Array.from({ length: N }, () => ({ id: 1, payload: "x".repeat(40), createdAt: new Date(MS) }));
const rowsMs = Array.from({ length: N }, () => ({ id: 1, payload: "x".repeat(40), createdAt: MS }));

let sink: any;
/** 行解码预热只 touch 值，不能调用 fn：重复解码会反复分配结果对象。 */
function bench(name: string, rows: any[], fn: (current: any[]) => void): void {
  for (let i = 0; i < 3; i++) {
    for (const row of rows) {
      sink = row.createdAt;
    }
  }
  let ms = 0;
  for (let run = 0; run < RUNS; run++) {
    // 每轮使用新副本，保持各轮输入形状一致。
    const current = rows.map((row) => {
      return { ...row };
    });
    const start = performance.now();
    fn(current);
    ms += performance.now() - start;
  }
  ms /= RUNS;
  // ns/行 = ms × 1e6 / 样本数；保留 1 位小数，避免 0 值显示失真。
  console.log(name.padEnd(42), ms.toFixed(1).padStart(8) + " ms", " ", ((ms * 1e6) / N).toFixed(1).padStart(6) + " ns/行");
}
/** 纯函数微基准可安全预热；storedInstant 不修改入参。 */
function microBench(name: string, fn: () => void): void {
  for (let i = 0; i < 3; i++) {
    fn();
  }
  let ms = 0;
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    fn();
    ms += performance.now() - start;
  }
  ms /= RUNS;
  console.log(name.padEnd(42), ms.toFixed(1).padStart(8) + " ms", " ", ((ms * 1e6) / N).toFixed(1).padStart(6) + " ns/行");
}

bench("decode — 无 datetime 列", rowsISO, (current) => {
  for (const row of current) {
    sink = decode(noDate, row, "inlineDates");
  }
});
bench("decode — datetime 为 NULL", rowsNull, (current) => {
  for (const row of current) {
    sink = decode(withDate, row, "inlineDates");
  }
});
bench("decode — ISO 字符串（SQLite 默认）", rowsISO, (current) => {
  for (const row of current) {
    sink = decode(withDate, row, "inlineDates");
  }
});
bench("decode — 整数毫秒（dateStorage=timestamp）", rowsMs, (current) => {
  for (const row of current) {
    sink = decode(withTs, row, "inlineDates");
  }
});
bench("decode — 值已是 Date 对象", rowsDate, (current) => {
  for (const row of current) {
    sink = decode(withDate, row, "inlineDates");
  }
});

microBench("storedInstant — fast path", () => {
  for (let i = 0; i < N; i++) {
    sink = storedInstant(ISO);
  }
});

void sink;
