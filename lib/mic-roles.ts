/** Simple mic-mode roles (not full A–G diarization). */

export const MIC_ROLES = [
  { id: 1, label: 'メインスピーカー' },
  { id: 2, label: '質問者' },
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
