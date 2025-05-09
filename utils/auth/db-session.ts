export function getDbUserIdFromToken(token: string | undefined): number | null {
  if (!token) return null;
  // token format: db-<id>-<timestamp>
  if (!token.startsWith('db-')) return null;
  const parts = token.split('-');
  if (parts.length < 3) return null;
  const idPart = parts[1];
  const idNum = parseInt(idPart, 10);
  return isNaN(idNum) ? null : idNum;
} 