import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async findAll(coopId: string) {
    return this.prisma.project.findMany({
      where: { coopId },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string, coopId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, coopId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async create(coopId: string, createProjectDto: CreateProjectDto) {
    const existing = await this.prisma.project.findFirst({
      where: {
        coopId,
        name: createProjectDto.name,
      },
    });

    if (existing) {
      throw new ConflictException('Project name already exists');
    }

    const { startDate, endDate, ...rest } = createProjectDto;

    const project = await this.prisma.project.create({
      data: {
        ...rest,
        coopId,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
    });

    // Auto-link to default channel
    const defaultChannel = await this.prisma.channel.findFirst({
      where: { coopId, isDefault: true },
    });
    if (defaultChannel) {
      await this.prisma.channelProject.create({
        data: { channelId: defaultChannel.id, projectId: project.id },
      });
    }

    return project;
  }

  async update(id: string, coopId: string, updateProjectDto: UpdateProjectDto) {
    const project = await this.findById(id, coopId);

    if (updateProjectDto.name && updateProjectDto.name !== project.name) {
      const existing = await this.prisma.project.findFirst({
        where: {
          coopId,
          name: updateProjectDto.name,
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException('Project name already exists');
      }
    }

    const { startDate, endDate, ...rest } = updateProjectDto;

    return this.prisma.project.update({
      where: { id },
      data: {
        ...rest,
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      },
    });
  }

  async importCsv(
    coopId: string,
    csvContent: string,
  ): Promise<{ imported: number; skipped: number }> {
    const lines = csvContent.split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
      throw new BadRequestException('CSV file is empty or has no data rows');
    }

    const dataLines = lines.slice(1);
    let imported = 0;
    let skipped = 0;

    for (const line of dataLines) {
      const fields = line.split(';').map((f) => f.trim().replace(/^"|"$/g, ''));
      const [name, description, type, capacityKw, estimatedAnnualMwh, startDate, endDate] = fields;

      if (!name) {
        skipped++;
        continue;
      }

      const existing = await this.prisma.project.findFirst({
        where: { coopId, name },
      });

      if (existing) {
        skipped++;
        continue;
      }

      const projectType =
        type?.toUpperCase() === 'WIND' ? 'WIND' : 'SOLAR';

      const project = await this.prisma.project.create({
        data: {
          coopId,
          name,
          description: description || null,
          type: projectType,
          capacityKw: capacityKw ? parseFloat(capacityKw.replace(',', '.')) : null,
          estimatedAnnualMwh: estimatedAnnualMwh
            ? parseFloat(estimatedAnnualMwh.replace(',', '.'))
            : null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
        },
      });

      // Auto-link to default channel
      const defaultChannel = await this.prisma.channel.findFirst({
        where: { coopId, isDefault: true },
      });
      if (defaultChannel) {
        await this.prisma.channelProject.create({
          data: { channelId: defaultChannel.id, projectId: project.id },
        });
      }

      imported++;
    }

    return { imported, skipped };
  }

  async delete(id: string, coopId: string) {
    const project = await this.findById(id, coopId);

    const sharesUsingProject = await this.prisma.share.count({
      where: { projectId: project.id },
    });

    if (sharesUsingProject > 0) {
      throw new BadRequestException('Cannot delete project with associated shares');
    }

    await this.prisma.project.delete({ where: { id } });
    return { message: 'Project deleted' };
  }
}
