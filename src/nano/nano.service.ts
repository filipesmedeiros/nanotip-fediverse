import { HttpService } from '@nestjs/axios'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Big from 'big.js'
import {
  deriveAddress,
  derivePublicKey,
  deriveSecretKey,
  hashBlock,
  signBlock,
} from 'nanocurrency'

import { Config } from '@app/lib/types'

import { AccountInfoResponse, NanotoPowResponse } from './lib/nano.types'

@Injectable()
export class NanoService {
  constructor(
    private configService: ConfigService<Config>,
    private httpService: HttpService
  ) {}

  getAddressAndPkFromIndex(index: number) {
    const seed = this.configService.get('NANO_SEED')
    const privateKey = deriveSecretKey(seed, index)
    const address = deriveAddress(derivePublicKey(privateKey), {
      useNanoPrefix: true,
    })

    return { address, privateKey }
  }

  async getNanoAccountInfo(account: string) {
    const accountRes =
      await this.httpService.axiosRef.post<AccountInfoResponse>('/', {
        action: 'account_info',
        account,
        include_confirmed: 'true',
      })

    if (accountRes.status >= 300) throw new Error(accountRes.statusText)

    return {
      balance: accountRes.data.confirmed_balance,
      frontier: accountRes.data.confirmed_frontier,
    }
  }

  async sendNano({
    from,
    to,
    amount,
    privateKey,
  }: {
    from: string
    to: string
    amount: string
    privateKey: string
  }) {
    Big.PE = 50

    const { frontier, balance } = await this.getNanoAccountInfo(from)

    const powRes = this.httpService.axiosRef.get<NanotoPowResponse>(
      `https://nano.to/${frontier}/pow`,
      { baseURL: undefined }
    )

    const newBalance = Big(balance).minus(amount).toString()

    const hash = hashBlock({
      account: from,
      previous: frontier,
      representative: this.configService.get('NANO_REPRESENTATIVE'),
      balance: newBalance,
      link: to,
    })

    const signature = signBlock({ secretKey: privateKey, hash })

    const { work } = (await powRes).data

    const processRes = await this.httpService.axiosRef.post<{ hash: string }>(
      '/',
      {
        action: 'process',
        json_block: 'true',
        subtype: 'send',
        block: {
          type: 'state',
          account: from,
          previous: frontier,
          representative: this.configService.get('NANO_REPRESENTATIVE'),
          balance: newBalance,
          link: to,
          signature,
          work,
        },
      }
    )

    return processRes.data
  }
}
