/** 解析目标账号的 driveId(admin 流程用; 与 graph.ts 的请求路径约定一致) */

const GRAPH = "https://graph.microsoft.com/v1.0";

export async function resolveDriveId(accessToken: string, upn?: string): Promise<string> {
  const url = upn ? `${GRAPH}/users/${encodeURIComponent(upn)}/drive` : `${GRAPH}/me/drive`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !data.id) {
    throw new Error("drive resolve failed");
  }
  return data.id;
}
