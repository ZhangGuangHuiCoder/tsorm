import type { Column } from "../schema/index.js";
import { fail } from "../shared/errors.js";
import { object } from "../shared/validation.js";
export type NumericUpdate<T = number, O = number> =
  | { set: T; increment?: never; decrement?: never; multiply?: never; divide?: never }
  | { increment: O; set?: never; decrement?: never; multiply?: never; divide?: never }
  | { decrement: O; set?: never; increment?: never; multiply?: never; divide?: never }
  | { multiply: O; set?: never; increment?: never; decrement?: never; divide?: never }
  | { divide: O; set?: never; increment?: never; decrement?: never; multiply?: never };
type ArithmeticOperation = "increment" | "decrement" | "multiply" | "divide";
export type UpdateValue = { kind: "set"; value: any } | { kind: "arithmetic"; value: number | bigint | string; operation: ArithmeticOperation };
export function updateValue(column: Column, value: any, encode: (c: Column, v: any) => any): UpdateValue {
  if (column.type === "json" && (!object(value) || !Object.hasOwn(value, "set"))) {
    return { kind: "set", value: encode(column, value) };
  }
  if (!object(value)) {
    return { kind: "set", value: encode(column, value) };
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    fail("Use exactly one field update operation");
  }
  const operation = keys[0];
  const operand = value[operation];
  if (operation === "set") {
    return { kind: "set", value: encode(column, operand) };
  }
  if (!["int", "bigint", "number", "decimal"].includes(column.type) || !["increment", "decrement", "multiply", "divide"].includes(operation)) {
    fail("Invalid numeric update operation");
  }
  if (column.type === "bigint" || column.type === "decimal") {
    // Validate the operand as a value of the column type, ignoring the column's size limits.
    const operandValue = encode({ ...column, nullable: false, precision: undefined, scale: undefined }, operand);
    if (operation === "divide" && Number(operandValue) === 0) {
      fail("Cannot divide by zero");
    }
    return { kind: "arithmetic", operation: operation as ArithmeticOperation, value: operandValue };
  }
  if (typeof operand !== "number" || !Number.isFinite(operand) || (column.type === "int" && !Number.isSafeInteger(operand))) {
    fail("Invalid numeric update operand");
  }
  if (operation === "divide" && operand === 0) {
    fail("Cannot divide by zero");
  }
  return { kind: "arithmetic", operation: operation as ArithmeticOperation, value: operand };
}
