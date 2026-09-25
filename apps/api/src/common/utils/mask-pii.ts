export function maskShareholderPII(shareholder: any) {
  // The list renders a name as `companyName || `${firstName} ${lastName}``, so all
  // three must be masked. Use a stable, non-identifying label so a coop admin
  // without canViewPII still sees a consistent placeholder per row.
  const maskedName = `Aandeelhouder #${shareholder.shareholderNumber || shareholder.id?.slice(-4) || '****'}`;
  return {
    ...shareholder,
    name: maskedName,
    firstName: maskedName,
    lastName: '',
    email: '***',
    phone: shareholder.phone ? '***' : null,
    address: shareholder.address ? '***' : null,
    city: shareholder.city ? '***' : null,
    postalCode: shareholder.postalCode ? '***' : null,
    companyName: shareholder.companyName ? maskedName : null,
    companyId: shareholder.companyId ? '***' : null,
  };
}

export function maskShareholderListPII(result: any) {
  if (Array.isArray(result)) {
    return result.map(maskShareholderPII);
  }
  // The paginated list endpoint returns `{ items, total, ... }`. (Older/other
  // shapes used `data` — handle both so masking never silently no-ops again.)
  if (result && Array.isArray(result.items)) {
    return { ...result, items: result.items.map(maskShareholderPII) };
  }
  if (result && Array.isArray(result.data)) {
    return { ...result, data: result.data.map(maskShareholderPII) };
  }
  return result;
}

export interface HouseholdCandidate {
  shareholderId: string;
  email: string | null;
  fullName: string;
  shareholderCount: number;
}

export function maskHouseholdCandidatesPII(candidates: HouseholdCandidate[]) {
  return candidates.map((candidate) => ({
    ...candidate,
    fullName: `Aandeelhouder #${candidate.shareholderId?.slice(-4) || '****'}`,
    email: '***',
  }));
}
