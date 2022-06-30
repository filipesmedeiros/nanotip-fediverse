import { Inject, Injectable, forwardRef } from '@nestjs/common'
import { checkAddress } from 'nanocurrency'

import { NanoService } from '@app/nano/nano.service'
import { PrismaService } from '@app/prisma/prisma.service'

@Injectable()
export class AccountsService {
  constructor(
    private prismaService: PrismaService,
    @Inject(forwardRef(() => NanoService))
    private nanoService: NanoService
  ) {}

  getAccount(fediverseUserIdOrNanoAddress: string) {
    const where = checkAddress(fediverseUserIdOrNanoAddress)
      ? { nanoAddress: fediverseUserIdOrNanoAddress }
      : { fediverseAccountId: fediverseUserIdOrNanoAddress }
    return this.prismaService.account.findUnique({
      where,
    })
  }

  async createAccount(fediverseUserId: string) {
    const index =
      (
        await this.prismaService.account.findFirst({
          orderBy: { nanoIndex: 'desc' },
        })
      )?.nanoIndex ?? -1
    const newIndex = index + 1
    const { address } = this.nanoService.getAddressAndPkFromIndex(newIndex)
    return this.prismaService.account.create({
      data: {
        fediverseAccountId: fediverseUserId,
        nanoIndex: newIndex,
        nanoAddress: address,
      },
    })
  }
}
