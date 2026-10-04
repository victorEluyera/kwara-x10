export function pollingUnitStatus(promoters) {
  const count = Number(promoters) || 0;
  return count >= 10 ? 'Reached' : count > 0 ? 'Partially reached' : 'Not reached';
}
