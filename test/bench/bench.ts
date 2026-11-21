/** 解码热路径微基准：量化每行调用的对象归一化/列遍历开销。 */
import { parseSchema, type Table } from "../../src/schema/index.js";
import { bigintsAsText, decode as scalarDecode, decodeNormalizedRow, encodeJson, type JsonDefinition } from "../../src/shared/index.js";

const schema = parseSchema(`
model Row {
  id: int @id @auto
  name: string
  email: string
  age: int
  score: number
  active: boolean
  price: decimal(10, 2)
  big: bigint
  payload: string
  createdAt: datetime
}
`);
const table: Table = schema.tables.Row;

// 混合行：大部分无 bigint/decimal 归一化需求，模拟典型结果集。
const rows: Record<string, unknown>[] = Array.from({ length: 20_000 }, (_, i) => {
  return {
    id: i,
    name: "name-" + i,
    email: "user" + i + "@example.com",
    age: 20 + (i % 50),
    score: i * 1.5,
    active: i % 2,
    price: String(i) + ".00",
    big: String(i),
    payload: "x".repeat(40),
    createdAt: new Date(Date.UTC(2024, 0, 1) + i * 1000).toISOString(),
  };
});

const N = rows.length;
// 重复轮数可用第一个参数指定（便于多次取中位数），默认沿用原有的 40 轮。
const argRuns = Number(process.argv[2]);
const ITER = Number.isSafeInteger(argRuns) && argRuns > 0 ? argRuns : 40;

function bench(name: string, fn: () => void): void {
  // 预热
  for (let i = 0; i < 5; i++) {
    fn();
  }
  const start = performance.now();
  for (let i = 0; i < ITER; i++) {
    fn();
  }
  const ms = (performance.now() - start) / ITER;
  // ns/行 = ms × 1e6 / 样本数；保留 1 位小数，避免 µs 误标成 ns。
  console.log(name.padEnd(40), ms.toFixed(2).padStart(8) + " ms/run", " ", ((ms * 1e6) / N).toFixed(1).padStart(7) + " ns/row");
}

// ─── 基准条目 ─────────────────────────────────────────────────────────────
bench("scalarDecode (cached cols)", () => {
  for (const row of rows) {
    scalarDecode(table, row, "inlineDates");
  }
});

bench("sqlite-style full decode", () => {
  for (const row of rows) {
    decodeNormalizedRow(table, row);
  }
});

// MySQL/PG 路径：列循环内内联解码 datetime，不做 SQLite 归一化。
bench("mysql-style inlineDates", () => {
  for (const row of rows) {
    scalarDecode(table, row, "inlineDates");
  }
});

// ─── bigintsAsText 微基准：每行含 bigint / 完全无 bigint ────────────────────
const rowsWithBigint: Record<string, unknown>[] = Array.from({ length: N }, (_, i) => {
  return { id: i, a: "x", b: "y", c: BigInt(i) };
});
const rowsNoBigint: Record<string, unknown>[] = Array.from({ length: N }, (_, i) => {
  return { id: i, a: "x", b: "y", c: "z" };
});

bench("bigintsAsText (row with bigint)", () => {
  for (const row of rowsWithBigint) {
    bigintsAsText(row);
  }
});

bench("bigintsAsText (row without bigint)", () => {
  for (const row of rowsNoBigint) {
    bigintsAsText(row);
  }
});

// ─── JSON 校验：当前惰性路径 ──────────────────────────────────────────────
const jsonDefinition: JsonDefinition = {
  root: {
    kind: "object",
    fields: {
      id: { optional: false, shape: { kind: "primitive", name: "number" } },
      name: { optional: false, shape: { kind: "primitive", name: "string" } },
      tags: { optional: false, shape: { kind: "array", element: { kind: "primitive", name: "string" } } },
    },
  },
  definitions: {},
};
const jsonValues = Array.from({ length: N }, (_, i) => {
  return { id: i, name: "n" + i, tags: ["a", "b", "c"] };
});

bench("encodeJson validation", () => {
  for (const value of jsonValues) {
    encodeJson(jsonDefinition, value, false, "meta");
  }
});
