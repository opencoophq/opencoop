import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConvocationService, SendConvocationOpts } from './convocation.service';

interface ConvocationJobData {
  coopId: string;
  meetingId: string;
  opts?: SendConvocationOpts;
}

@Processor('meetings-convocation')
export class ConvocationProcessor {
  private readonly logger = new Logger(ConvocationProcessor.name);

  constructor(private readonly convocation: ConvocationService) {}

  @Process('send')
  async send(job: Job<ConvocationJobData>) {
    const { coopId, meetingId, opts } = job.data;
    this.logger.log(
      `Processing convocation send for meeting ${meetingId} (coop ${coopId}, attempt ${job.attemptsMade + 1})`,
    );
    try {
      const result = await this.convocation.processSend(coopId, meetingId, opts ?? {});
      const summary =
        'alreadySent' in result && result.alreadySent
          ? 'already sent to all recipients'
          : `sent ${result.sent.length}, failed ${result.failures.length}`;
      this.logger.log(`Convocation send for meeting ${meetingId} complete: ${summary}`);
      return result;
    } catch (err) {
      // Re-throw so Bull records the failure and retries per the queue's
      // configured attempts/backoff. The send is idempotent via
      // convocationSentAt, so a retry only re-mails groups not yet marked sent.
      this.logger.error(
        `Convocation send for meeting ${meetingId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
