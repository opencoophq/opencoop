import { Injectable } from '@nestjs/common';
import * as ics from 'ics';

export interface IcsInput {
  uid: string;
  title: string;
  start: Date;
  durationMinutes: number;
  location: string;
  description: string;
  organizerName: string;
  organizerEmail: string;
}

@Injectable()
export class IcsService {
  generate(input: IcsInput): string {
    const start: ics.DateArray = [
      input.start.getUTCFullYear(),
      input.start.getUTCMonth() + 1,
      input.start.getUTCDate(),
      input.start.getUTCHours(),
      input.start.getUTCMinutes(),
    ];
    const { error, value } = ics.createEvent({
      uid: input.uid,
      start,
      startInputType: 'utc',
      duration: {
        hours: Math.floor(input.durationMinutes / 60),
        minutes: input.durationMinutes % 60,
      },
      title: input.title,
      description: input.description,
      location: input.location,
      organizer: { name: input.organizerName, email: input.organizerEmail },
      method: 'REQUEST',
    });
    if (error) throw error;
    if (!value) throw new Error('ics generation returned no value');
    return value;
  }
}
