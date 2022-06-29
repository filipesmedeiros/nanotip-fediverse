import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Config } from '@app/lib/types'
import { NanoService } from '@app/nano/nano.service'
import { PrismaService } from '@app/prisma/prisma.service'

@Injectable()
export class AccountsService {
  constructor(
    private configService: ConfigService<Config>,
    private prismaService: PrismaService,
    private nanoService: NanoService
  ) {}

  getAccount(fediverseUserId: string) {
    return this.prismaService.account.findUnique({
      where: { fediverseAccountId: fediverseUserId },
    })
  }

  async createAccount(fediverseUserId: string) {
    const index =
      (
        await this.prismaService.account.findFirst({
          orderBy: { nanoIndex: 'desc' },
        })
      )?.nanoIndex ?? 0
    const { address } = this.nanoService.getAddressAndPkFromIndex(index)
    return this.prismaService.account.create({
      data: {
        fediverseAccountId: fediverseUserId,
        nanoIndex: index,
        nanoAddress: address,
      },
    })
  }
}
