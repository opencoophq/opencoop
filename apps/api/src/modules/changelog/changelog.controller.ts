import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';

export interface ChangelogSection {
  type: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

@ApiTags('Changelog')
@Controller('changelog')
export class ChangelogController {
  private cache: { entries: ChangelogEntry[]; expiresAt: number } | null = null;

  @Get()
  @ApiOperation({ summary: 'Get platform changelog' })
  getChangelog(): ChangelogEntry[] {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.entries;
    }

    const candidates = [
      path.resolve(__dirname, '../../../../../CHANGELOG.md'), // dev: 5 levels up from dist/
      path.resolve(__dirname, '../../../CHANGELOG.md'), // docker prod: 3 levels up from /app/dist/
    ];
    const changelogPath = candidates.find((p) => fs.existsSync(p));

    if (!changelogPath) {
      return [];
    }

    const content = fs.readFileSync(changelogPath, 'utf-8');
    const entries = this.parseChangelog(content);
    this.cache = { entries, expiresAt: now + 5 * 60 * 1000 };
    return entries;
  }

  private parseChangelog(content: string): ChangelogEntry[] {
    const entries: ChangelogEntry[] = [];
    const lines = content.split('\n');

    let currentEntry: ChangelogEntry | null = null;
    let currentSection: ChangelogSection | null = null;

    for (const line of lines) {
      const versionMatch = line.match(/^## \[(.+?)\] - (\d{4}-\d{2}-\d{2})/);
      if (versionMatch) {
        if (currentEntry) {
          if (currentSection) currentEntry.sections.push(currentSection);
          entries.push(currentEntry);
        }
        currentEntry = { version: versionMatch[1], date: versionMatch[2], sections: [] };
        currentSection = null;
        continue;
      }

      const sectionMatch = line.match(/^### (.+)/);
      if (sectionMatch && currentEntry) {
        if (currentSection) currentEntry.sections.push(currentSection);
        currentSection = { type: sectionMatch[1], items: [] };
        continue;
      }

      const itemMatch = line.match(/^- (.+)/);
      if (itemMatch && currentSection) {
        currentSection.items.push(itemMatch[1]);
      }
    }

    if (currentEntry) {
      if (currentSection) currentEntry.sections.push(currentSection);
      entries.push(currentEntry);
    }

    return entries;
  }
}
