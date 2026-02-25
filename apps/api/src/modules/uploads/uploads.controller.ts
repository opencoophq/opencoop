import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  @Get('logos/:filename')
  @ApiOperation({ summary: 'Serve a coop logo image' })
  async serveLogo(@Param('filename') filename: string, @Res() res: Response) {
    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(filename);
    const filePath = path.join(UPLOAD_DIR, 'logos', sanitized);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Logo not found');
    }

    const ext = path.extname(sanitized).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.webp': 'image/webp',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    fs.createReadStream(filePath).pipe(res);
  }
}
