export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

export function formatConfidence(confidence: number): string {
  const normalized = confidence > 1 ? confidence : confidence * 100;
  return `${Math.round(normalized)}%`;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function getInstitutionInfo(institution: string | null): {
  name: string;
  shortName: string;
  color: string;
  bgColor: string;
} {
  const institutions: Record<string, { name: string; shortName: string; color: string; bgColor: string }> = {
    INSTITUTION_A: { name: 'Primary Hospital', shortName: 'HOSP_A', color: 'text-blue-700', bgColor: 'bg-blue-100' },
    INSTITUTION_B: { name: 'Department', shortName: 'DEPT', color: 'text-red-700', bgColor: 'bg-red-100' },
  };
  return institutions[institution || ''] || { name: 'All Sources', shortName: 'All', color: 'text-gray-700', bgColor: 'bg-gray-100' };
}
