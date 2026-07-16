import { Injectable } from '@nestjs/common';
import type { Address } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import type { AddressDto } from './addresses.controller';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<Address[]> {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
  }

  async create(userId: string, dto: AddressDto): Promise<Address> {
    const count = await this.prisma.address.count({ where: { userId } });
    const makeDefault = dto.isDefault || count === 0; // first address is default
    return this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.create({ data: { ...dto, userId, isDefault: makeDefault } });
    });
  }

  async update(userId: string, id: string, dto: AddressDto): Promise<Address> {
    await this.ownedOrThrow(userId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.update({ where: { id }, data: dto });
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const addr = await this.ownedOrThrow(userId, id);
    await this.prisma.address.delete({ where: { id } });
    // If we removed the default, promote another address to default.
    if (addr.isDefault) {
      const next = await this.prisma.address.findFirst({ where: { userId }, orderBy: { id: 'asc' } });
      if (next) await this.prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }

  private async ownedOrThrow(userId: string, id: string): Promise<Address> {
    const addr = await this.prisma.address.findUnique({ where: { id } });
    if (!addr) throw AppError.notFound('Address');
    if (addr.userId !== userId) throw AppError.forbidden();
    return addr;
  }
}
