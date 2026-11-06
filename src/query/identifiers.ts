export const quoteIdentifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export const quoteMysqlIdentifier = (name: string) => '`' + name.replaceAll('`', '``') + '`';
