import { capitalByProjectQuery } from './capital-by-project.query';

function sqlText(query: { strings: readonly string[] }): string {
  return query.strings.join(' ');
}

describe('capitalByProjectQuery', () => {
  it('sums payments once per registration so instalments do not multiply the share count', () => {
    const text = sqlText(capitalByProjectQuery('coop-1', null, null));
    expect(text).toContain('SUM(p.amount)');
    expect(text).toContain('GROUP BY p."registrationId"');
    expect(text).not.toContain('LEFT JOIN payments p ON');
    expect(text).not.toContain('IS NOT NULL');
  });

  it('drops registrations with no payment inside a date window', () => {
    const since = new Date('2026-01-01T00:00:00.000Z');
    const until = new Date('2026-06-01T00:00:00.000Z');
    const query = capitalByProjectQuery('coop-1', since, until);
    const text = sqlText(query);
    expect(text).toContain('p."bankDate" >=');
    expect(text).toContain('p."bankDate" <=');
    expect(text).toContain('pay."registrationId" IS NOT NULL');
    expect(query.values).toEqual(expect.arrayContaining([since, until, 'coop-1']));
  });
});
