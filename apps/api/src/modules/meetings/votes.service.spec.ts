import { Test } from '@nestjs/testing';
import { VotesService } from './votes.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MajorityType } from '@opencoop/database';

describe('VotesService.computeOutcome', () => {
  let service: VotesService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [VotesService, { provide: PrismaService, useValue: {} }],
    }).compile();
    service = moduleRef.get(VotesService);
  });

  // SIMPLE MAJORITY (strict) — abstentions ignored, tie = rejected
  it('simple: 5 for, 4 against -> passed', () => {
    expect(
      service.computeOutcome({
        majorityType: MajorityType.SIMPLE,
        votesFor: 5,
        votesAgainst: 4,
        votesAbstain: 0,
      }),
    ).toBe(true);
  });

  it('simple: 5 for, 5 against -> NOT passed (tie = rejected)', () => {
    expect(
      service.computeOutcome({
        majorityType: MajorityType.SIMPLE,
        votesFor: 5,
        votesAgainst: 5,
        votesAbstain: 0,
      }),
    ).toBe(false);
  });

  it('simple: abstentions ignored', () => {
    expect(
      service.computeOutcome({
        majorityType: MajorityType.SIMPLE,
        votesFor: 3,
        votesAgainst: 2,
        votesAbstain: 100,
      }),
    ).toBe(true);
  });

  it('simple: 0 for, 0 against -> NOT passed (no strict majority)', () => {
    expect(
      service.computeOutcome({
        majorityType: MajorityType.SIMPLE,
        votesFor: 0,
        votesAgainst: 0,
        votesAbstain: 10,
      }),
    ).toBe(false);
  });

  // TWO_THIRDS — abstentions excluded from numerator AND denominator
  it('two-thirds: 6 for, 3 against, 99 abstain -> passed (6*3 >= 9*2)', () => {
    expect(
      service.computeOutcome({
        majorityType: MajorityType.TWO_THIRDS,
        votesFor: 6,
        votesAgainst: 3,
        votesAbstain: 99,
      }),
    ).toBe(true);
  });

  it('two-thirds: 5 for, 3 against -> NOT passed (15 < 16)', () => {
    expect(
      service.computeOutcome({
        majorityType: MajorityType.TWO_THIRDS,
        votesFor: 5,
        votesAgainst: 3,
        votesAbstain: 0,
      }),
    ).toBe(false);
  });

  // THREE_QUARTERS (Art. 25) — abstentions excluded from numerator AND denominator
  it('three-quarters: 9 for, 3 against -> passed (9*4 >= 12*3)', () => {
    expect(
      service.computeOutcome({
        majorityType: MajorityType.THREE_QUARTERS,
        votesFor: 9,
        votesAgainst: 3,
        votesAbstain: 0,
      }),
    ).toBe(true);
  });

  it('three-quarters: 8 for, 3 against, 100 abstain -> NOT passed (32 < 33)', () => {
    expect(
      service.computeOutcome({
        majorityType: MajorityType.THREE_QUARTERS,
        votesFor: 8,
        votesAgainst: 3,
        votesAbstain: 100,
      }),
    ).toBe(false);
  });
});
