/** Simple mic-mode roles (aligned with Zoom seminar / self buckets). */

export const MIC_ROLES = [
  { id: 2, label: 'セミナー' },
  { id: 1, label: '自分' },
] as const;

export type MicRoleId = (typeof MIC_ROLES)[number]['id'];

export function micRoleLabel(id: number | undefined | null): string | null {
  if (id == null) return null;
  const hit = MIC_ROLES.find((r) => r.id === id);
  return hit?.label ?? null;
}

export function isMicRoleId(id: number | undefined | null): boolean {
  return id === 1 || id === 2;
}
