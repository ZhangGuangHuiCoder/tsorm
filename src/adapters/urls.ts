/** Datasource URL schemes, shared by the providers and the lazy loader so no driver is loaded to tell them apart. */
export const isPostgresUrl = (url: string): boolean => {
  return /^postgres(ql)?:\/\//i.test(url);
};
export const isMysqlUrl = (url: string): boolean => {
  return /^(mysql|mariadb):\/\//i.test(url);
};
/** Anything without a URL scheme is a SQLite path. */
export const isSqliteUrl = (url: string): boolean => {
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(url);
};
