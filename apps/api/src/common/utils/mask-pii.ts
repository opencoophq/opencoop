export function maskShareholderPII(shareholder: any) {
  return {
    ...shareholder,
    name: `Aandeelhouder #${shareholder.shareholderNumber || shareholder.id?.slice(-4) || '****'}`,
    email: '***',
    phone: shareholder.phone ? '***' : null,
    address: shareholder.address ? '***' : null,
    city: shareholder.city ? '***' : null,
    postalCode: shareholder.postalCode ? '***' : null,
    companyName: shareholder.companyName ? '***' : null,
    companyId: shareholder.companyId ? '***' : null,
  };
}

export function maskShareholderListPII(result: any) {
  if (Array.isArray(result)) {
    return result.map(maskShareholderPII);
  }
  if (result && Array.isArray(result.data)) {
    return { ...result, data: result.data.map(maskShareholderPII) };
  }
  return result;
}
