export const quoteIdentifier = (name: string) => {
  return '"' + name.replaceAll('"', '""') + '"';
};
export const quoteMysqlIdentifier = (name: string) => {
  return "`" + name.replaceAll("`", "``") + "`";
};
