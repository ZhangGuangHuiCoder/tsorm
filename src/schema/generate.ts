import { jsonTypeText } from '../shared/json.js';
import type { Schema, Column } from './index.js';
function ts(c: Column, input = false): string {
  if (c.type === 'json')
    return (
      (input
        ? 'JsonInput<' + jsonTypeText(c.json!.root) + ',' + c.nullable + '>'
        : jsonTypeText(c.json!.root)) + (c.nullable ? ' | null' : '')
    );
  const base = c.enum
    ? c.enum.map((x) => JSON.stringify(x)).join(' | ')
    : c.type === 'int'
      ? 'number'
      : c.type === 'bigint'
        ? input
          ? 'bigint | number'
          : 'bigint'
        : c.type === 'decimal'
          ? input
            ? 'string | number'
            : 'string'
          : c.type === 'date'
            ? input
              ? 'DateTimeInput'
              : 'DateTime'
            : c.type === 'bytes'
              ? 'Uint8Array'
              : c.type;
  return base + (c.nullable ? ' | null' : '');
}
export function generateClient(schema: Schema, runtimeImport = './index.js'): string {
  const lines = [
    `// Generated from schema.orm. Do not edit.`,
    `import { createClient as createORMClient } from ${JSON.stringify(runtimeImport)};`,
    `import type { Schema, ClientOptions, FieldUpdate, DecimalUpdate, Where, DateTime, DateTimeInput, JsonInput, Virtuals, WithVirtuals, GlobalOmit } from ${JSON.stringify(runtimeImport)};`,
  ];
  for (const [name, shape] of Object.entries(schema.jsonTypes ?? {}))
    lines.push('export type ' + name + ' = ' + jsonTypeText(shape) + ';');
  for (const t of Object.values(schema.tables)) {
    lines.push(
      `export type ${t.name}Row = {`,
      ...Object.values(t.columns).map((c) => `  ${JSON.stringify(c.name)}: ${ts(c)};`),
      '};',
    );
    const scalar = Object.values(t.columns).filter(
      (c) =>
        !c.auto &&
        c.name !== t.softDelete &&
        !Object.values(t.relations).some((r) => r.owner && !r.many && r.source === c.name),
    );
    const base = scalar
      .map(
        (c) =>
          `${JSON.stringify(c.name)}${c.default !== undefined || c.updatedAt ? '?' : ''}: ${ts(c, true)}`,
      )
      .join('; ');
    const parts = [
      `{ ${base}; ${Object.values(t.columns)
        .filter((c) => c.auto)
        .map((c) => JSON.stringify(c.name) + '?: never')
        .join('; ')} }`,
    ];
    for (const r of Object.values(t.relations)) {
      const target = schema.tables[r.target];
      const rel = JSON.stringify(r.name);
      if (r.owner && !r.many) {
        const fk = JSON.stringify(r.source);
        const col = t.columns[r.source];
        parts.push(
          `({ ${fk}${r.nullable ? '?' : ''}: ${ts(col, true)}; ${rel}?: never } | { ${fk}?: never; ${rel}: OneOf<{ create: ${r.target}Create; connect: ${r.target}Unique; connectOrCreate: { where: ${r.target}Unique; create: ${r.target}Create } }> })`,
        );
      } else {
        const reverse = Object.values(target.relations).find(
          (x) => x.owner && !x.many && x.source === r.foreign && x.target === t.name,
        );
        const create = r.junction
          ? `${r.target}Create`
          : `DistributiveOmit<${r.target}Create, ${JSON.stringify(r.foreign)}${reverse ? ' | ' + JSON.stringify(reverse.name) : ''}>`;
        const connectOrCreate = `{ where: ${r.target}Unique; create: ${create} }`;
        const operations = [
          `create: ${create}${r.many ? ' | (' + create + ')[]' : ''}`,
          `connect: ${r.target}Unique${r.many ? ' | ' + r.target + 'Unique[]' : ''}`,
          `connectOrCreate: ${connectOrCreate}${r.many ? ' | ' + connectOrCreate + '[]' : ''}`,
        ];
        if (r.many && !r.junction)
          operations.push(
            `createMany: { data: DistributiveOmit<${r.target}ScalarCreate, ${JSON.stringify(r.foreign)}>[]; skipDuplicates?: boolean }`,
          );
        parts.push(`{ ${rel}?: ${r.many ? 'AtLeastOne' : 'OneOf'}<{ ${operations.join('; ')} }> }`);
      }
    }
    lines.push(`export type ${t.name}Create = ${parts.join(' & ')};`);

    lines.push(
      'export type ' +
        t.name +
        'ScalarUpdate = { ' +
        Object.values(t.columns)
          .filter((c) => !c.primary && !c.auto && c.name !== t.softDelete)
          .map(
            (c) =>
              JSON.stringify(c.name) +
              (c.type === 'decimal' ? '?: DecimalUpdate<' : '?: FieldUpdate<') +
              ts(c, true) +
              '>',
          )
          .join('; ') +
        ' };',
    );
    const relationUpdates = Object.values(t.relations).map((r) => {
      const target = schema.tables[r.target];
      const reverse = Object.values(target.relations).find(
        (x) => x.owner && !x.many && x.source === r.foreign && x.target === t.name,
      );
      const nestedCreate =
        r.owner || r.junction
          ? r.target + 'Create'
          : 'DistributiveOmit<' +
            r.target +
            'Create, ' +
            JSON.stringify(r.foreign) +
            (reverse ? ' | ' + JSON.stringify(reverse.name) : '') +
            '>';
      const detachable =
        !!r.junction ||
        (r.owner ? t.columns[r.source].nullable : target.columns[r.foreign].nullable);
      const item = '{where:' + r.target + 'Unique;data:' + r.target + 'Update}';
      const operations = [
        'update: ' + (r.many ? item + ' | ' + item + '[]' : r.target + 'Update'),
        'delete: ' + (r.many ? r.target + 'Unique | ' + r.target + 'Unique[]' : 'true'),
        'connect: ' + r.target + 'Unique' + (r.many ? ' | ' + r.target + 'Unique[]' : ''),
        'create: ' + nestedCreate + (r.many ? ' | (' + nestedCreate + ')[]' : ''),
      ];
      const connectOrCreate = '{where:' + r.target + 'Unique;create:' + nestedCreate + '}';
      const upsert =
        '{' +
        (r.many ? 'where:' + r.target + 'Unique;' : '') +
        'create:' +
        nestedCreate +
        ';update:' +
        r.target +
        'Update}';
      operations.push(
        'connectOrCreate: ' + connectOrCreate + (r.many ? ' | ' + connectOrCreate + '[]' : ''),
      );
      operations.push('upsert: ' + upsert + (r.many ? ' | ' + upsert + '[]' : ''));
      if (r.many) {
        const updateMany =
          '{where?:Where<Models,' +
          JSON.stringify(r.target) +
          '>;data:' +
          r.target +
          'ScalarUpdate}';
        operations.push('updateMany: ' + updateMany + ' | ' + updateMany + '[]');
        operations.push(
          'deleteMany: Where<Models,' +
            JSON.stringify(r.target) +
            '> | Where<Models,' +
            JSON.stringify(r.target) +
            '>[]',
        );
        if (!r.junction)
          operations.push(
            'createMany: {data:DistributiveOmit<' +
              r.target +
              'ScalarCreate,' +
              JSON.stringify(r.foreign) +
              '>[];skipDuplicates?:boolean}',
          );
      }
      if (detachable)
        operations.push(
          'disconnect: ' + (r.many ? r.target + 'Unique | ' + r.target + 'Unique[]' : 'true'),
        );
      if (r.many) operations.push('set: ' + r.target + 'Unique[]');
      return (
        JSON.stringify(r.name) +
        '?: ' +
        (r.many ? 'AtLeastOne' : 'OneOf') +
        '<{' +
        operations.join('; ') +
        '}>'
      );
    });
    lines.push(
      'export type ' +
        t.name +
        'Update = ' +
        t.name +
        'ScalarUpdate & {' +
        relationUpdates.join('; ') +
        '};',
    );
    lines.push(
      'export type ' +
        t.name +
        'ScalarCreate = { ' +
        Object.values(t.columns)
          .filter((c) => !c.auto && c.name !== t.softDelete)
          .map(
            (c) =>
              JSON.stringify(c.name) +
              (c.default !== undefined || c.updatedAt ? '?' : '') +
              ': ' +
              ts(c, true),
          )
          .join('; ') +
        ' };',
    );
    const unique = Object.values(t.columns)
      .filter((c) => c.primary || c.unique)
      .map((c) => `{ ${JSON.stringify(c.name)}: ${ts({ ...c, nullable: false }, true)} }`);
    for (const keys of [...(t.primaryKey?.length ? [t.primaryKey] : []), ...t.unique])
      unique.push(
        `{ ${keys.map((k) => JSON.stringify(k) + ': ' + ts({ ...t.columns[k], nullable: false }, true)).join('; ')} }`,
      );
    lines.push(`export type ${t.name}Unique = ${unique.join(' | ')};`);
  }
  lines.push(
    'type AtLeastOne<T> = {[K in keyof T]:Required<Pick<T,K>> & Partial<Omit<T,K>>}[keyof T];',
    'type OneOf<T> = {[K in keyof T]:{[P in K]:T[P]} & {[P in Exclude<keyof T,K>]?:never}}[keyof T];',
    'type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;',
    'export type Models = {',
  );
  for (const t of Object.values(schema.tables))
    lines.push(
      `${JSON.stringify(t.name)}: { row: ${t.name}Row; create: ${t.name}Create; update: ${t.name}Update; dateFields:${
        Object.values(t.columns)
          .filter((c) => c.type === 'date')
          .map((c) => JSON.stringify(c.name))
          .join(' | ') || 'never'
      }; jsonFields:${
        Object.values(t.columns)
          .filter((c) => c.type === 'json')
          .map((c) => JSON.stringify(c.name))
          .join(' | ') || 'never'
      }; scalarCreate:${t.name}ScalarCreate; scalarUpdate:${t.name}ScalarUpdate; unique: ${t.name}Unique; relations: { ${Object.values(
        t.relations,
      )
        .map(
          (r) =>
            `${JSON.stringify(r.name)}: { target: ${JSON.stringify(r.target)}; many: ${r.many}; nullable: ${r.nullable} }`,
        )
        .join('; ')} } };`,
    );
  lines.push(
    '};',
    `export const schema: Schema = ${JSON.stringify(schema, null, 2)};`,
    `export const createClient = <const V extends Virtuals<Models> = {}, const O extends GlobalOmit<WithVirtuals<Models,V>> = {}>(options: ClientOptions<Models,V,O>) => createORMClient<Models,V,O>(schema, options);`,
  );
  return lines.join('\n') + '\n';
}
