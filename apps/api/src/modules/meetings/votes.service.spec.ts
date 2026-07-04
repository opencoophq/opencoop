import { Test } from '@nestjs/testing';
import { VotesService } from './votes.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MajorityType, RegistrationType, VoteChoice, VotingWeight } from '@opencoop/database';

type VoteRegistrationFixture = {
  type: RegistrationType;
  quantity: number;
};

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

describe('VotesService.recordVotes', () => {
  const createService = async (
    registrationRowsByShareholder: Record<string, VoteRegistrationFixture[]>,
  ) => {
    const storedVotes: Array<{ shareholderId: string; choice: VoteChoice; weight: number }> = [];
    const tx = {
      registration: {
        findMany: jest.fn(({ where }) => {
          const shareholderId = where?.shareholderId;
          return Promise.resolve(registrationRowsByShareholder[shareholderId] ?? []);
        }),
      },
      vote: {
        upsert: jest.fn(({ create, update, where }) => {
          const shareholderId = where.resolutionId_shareholderId.shareholderId;
          const existing = storedVotes.find((v) => v.shareholderId === shareholderId);
          if (existing) {
            Object.assign(existing, update);
          } else {
            storedVotes.push({
              shareholderId,
              choice: create.choice,
              weight: create.weight,
            });
          }
          return Promise.resolve(existing ?? create);
        }),
        aggregate: jest.fn(({ where }) => {
          const sum = storedVotes
            .filter((v) => v.choice === where.choice)
            .reduce((total, v) => total + v.weight, 0);
          return Promise.resolve({ _sum: { weight: sum } });
        }),
      },
      resolution: {
        update: jest.fn(({ data }) => Promise.resolve(data)),
      },
    };
    const prisma = {
      resolution: {
        findUnique: jest.fn().mockResolvedValue({
          closedAt: null,
          agendaItem: {
            meeting: {
              id: 'meeting-1',
              coopId: 'coop-1',
              votingWeight: VotingWeight.PER_SHARE,
            },
          },
        }),
      },
      shareholder: {
        findMany: jest.fn(({ where }) =>
          Promise.resolve(where.id.in.map((id: string) => ({ id }))),
        ),
      },
      proxy: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [VotesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    return {
      service: moduleRef.get(VotesService),
      prisma,
      tx,
      storedVotes,
    };
  };

  it('weights transfer recipients from their own BUY row in PER_SHARE meetings', async () => {
    const { service, tx, storedVotes } = await createService({
      'shareholder-recipient': [
        { type: RegistrationType.BUY, quantity: 7 },
      ],
    });

    const result = await service.recordVotes('coop-1', 'resolution-1', [
      { shareholderId: 'shareholder-recipient', choice: VoteChoice.FOR },
    ]);

    expect(tx.registration.findMany).toHaveBeenCalledWith({
      where: {
        shareholderId: 'shareholder-recipient',
        status: { in: ['ACTIVE', 'COMPLETED'] },
        type: { in: ['BUY', 'SELL'] },
      },
      select: {
        type: true,
        quantity: true,
      },
    });
    expect(storedVotes[0].weight).toBe(7);
    expect(result.votesFor).toBe(7);
  });

  it('does not floor zero-share PER_SHARE voters to weight one', async () => {
    const { service, storedVotes } = await createService({
      'shareholder-former': [
        {
          type: RegistrationType.BUY,
          quantity: 5,
        },
        {
          type: RegistrationType.SELL,
          quantity: 5,
        },
      ],
    });

    const result = await service.recordVotes('coop-1', 'resolution-1', [
      { shareholderId: 'shareholder-former', choice: VoteChoice.AGAINST },
    ]);

    expect(storedVotes[0].weight).toBe(0);
    expect(result.votesAgainst).toBe(0);
  });

});
