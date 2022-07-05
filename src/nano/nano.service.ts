import { HttpService } from '@nestjs/axios'
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Big from 'big.js'
import {
  Unit,
  checkSignature,
  convert,
  deriveAddress,
  derivePublicKey,
  deriveSecretKey,
  hashBlock,
  signBlock,
} from 'nanocurrency'

import { AccountsService } from '@app/accounts/accounts.service'
import { Config } from '@app/lib/types'

import {
  AccountInfoResponse,
  AccountReceivableResponse,
  NanotoPowResponse,
} from './lib/nano.types'

@Injectable()
export class NanoService {
  static zeroString =
    '0000000000000000000000000000000000000000000000000000000000000000'

  private readonly logger = new Logger(NanoService.name)

  constructor(
    private configService: ConfigService<Config>,
    private httpService: HttpService,
    @Inject(forwardRef(() => AccountsService))
    private accountsService: AccountsService
  ) {}

  validateSignature(signature: string) {
    return checkSignature(signature)
  }

  nanoToRaw(nano: number) {
    const amountInRaw = convert(nano.toString(), {
      from: Unit.Nano,
      to: Unit.raw,
    })

    return amountInRaw
  }

  rawToNano(raw: string) {
    const amountInNano = convert(raw, {
      from: Unit.raw,
      to: Unit.Nano,
    })

    return +amountInNano
  }

  getAddressAndPkFromIndex(index: number) {
    const seed = this.configService.get('NANO_SEED')
    const privateKey = deriveSecretKey(seed, index)
    const address = deriveAddress(derivePublicKey(privateKey), {
      useNanoPrefix: true,
    })

    return { address, privateKey }
  }

  async getNanoAccountInfo(
    account: string,
    {
      balanceIncludeReceivable = false,
    }: { balanceIncludeReceivable: boolean } = {
      balanceIncludeReceivable: false,
    }
  ) {
    const accountRes =
      await this.httpService.axiosRef.post<AccountInfoResponse>('/', {
        action: 'account_info',
        account,
        representative: 'true',
        include_confirmed: 'true',
        receivable: 'true',
        pending: 'true',
      })

    if (accountRes.status >= 300) throw new Error(accountRes.statusText)

    const data = accountRes.data
    if ('error' in data) return undefined

    return {
      balance: !balanceIncludeReceivable
        ? data.confirmed_balance
        : Big(data.confirmed_balance)
            .plus(data.confirmed_receivable ?? data.confirmed_pending)
            .toString(),
      frontier: data.confirmed_frontier,
      representative: data.confirmed_representative,
    }
  }

  async getNanoAccountReceivables(account: string) {
    const accountRes =
      await this.httpService.axiosRef.post<AccountReceivableResponse>('/', {
        action: 'receivable',
        account,
        source: 'true',
      })

    const blocks = accountRes.data.blocks

    if (accountRes.status >= 300) throw new Error(accountRes.statusText)

    return blocks === '' ? {} : blocks
  }

  async accountHasReceivables(account: string) {
    const receivables = await this.getNanoAccountReceivables(account)

    return Object.entries(receivables).length !== 0
  }

  async sendNano({
    from,
    to,
    amount,
    privateKey,
    cachedInfo,
  }: {
    from: string
    to: string
    amount: string
    privateKey: string
    cachedInfo?: {
      frontier: string
      balance: string
    }
  }) {
    await this.receiveAllReceivables(from)

    const { frontier, balance } =
      cachedInfo ?? (await this.getNanoAccountInfo(from))

    const work = await this.getWorkForHash(frontier)

    const newBalance = Big(balance).minus(amount).toString()

    const hashData = {
      account: from,
      previous: frontier,
      representative: this.configService.get('NANO_REPRESENTATIVE'),
      balance: newBalance,
      link: to,
    }

    const hash = hashBlock(hashData)

    const signature = signBlock({ secretKey: privateKey, hash })

    const processRes = await this.httpService.axiosRef.post<
      { hash: string } | { error: string }
    >('/', {
      action: 'process',
      json_block: 'true',
      subtype: 'send',
      block: {
        type: 'state',
        ...hashData,
        signature,
        work,
      },
    })

    if ('error' in processRes.data) throw new Error(processRes.data.error)

    return { hash: processRes.data.hash, newBalance }
  }

  async sendSignedNano({
    from,
    to,
    representative,
    signature,
    balance,
    previous,
  }: {
    from: string
    to: string
    balance: string
    signature: string
    representative: string
    previous: string
  }) {
    const work = await this.getWorkForHash(previous)

    const processRes = await this.httpService.axiosRef.post<
      { hash: string } | { error: string }
    >('/', {
      action: 'process',
      json_block: 'true',
      subtype: 'send',
      block: {
        type: 'state',
        account: from,
        previous,
        representative,
        balance,
        link: to,
        signature,
        work,
      },
    })

    if ('error' in processRes.data) throw new Error(processRes.data.error)

    return processRes.data.hash
  }

  private async receiveAllReceivables(account: string) {
    const receivables = await this.getNanoAccountReceivables(account)

    const results = await Promise.all([
      this.getNanoAccountInfo(account),
      this.accountsService.getAccount(account),
    ])

    let { frontier, balance } = results[0] ?? {
      frontier: NanoService.zeroString,
      balance: '0',
    }
    const { nanoIndex } = results[1]

    const { privateKey } = this.getAddressAndPkFromIndex(nanoIndex)

    for (const [sendHash, { amount }] of Object.entries(receivables)) {
      const { hash, newBalance } = await this.receiveNano({
        sendHash,
        to: account,
        amount,
        cachedInfo: { frontier, balance },
        privateKey,
      })

      frontier = hash
      balance = newBalance
    }
  }

  private async receiveNano({
    sendHash,
    to,
    amount,
    privateKey,
    cachedInfo,
  }: {
    sendHash: string
    to: string
    amount: string
    privateKey: string
    cachedInfo?: {
      balance: string
      frontier: string
    }
  }) {
    const { frontier, balance } =
      cachedInfo ?? (await this.getNanoAccountInfo(to))

    const workFor =
      frontier === NanoService.zeroString
        ? derivePublicKey(privateKey)
        : frontier
    const work = await this.getWorkForHash(workFor)

    const newBalance = Big(balance).plus(amount).toString()

    const hashData = {
      account: to,
      previous: frontier,
      representative: this.configService.get('NANO_REPRESENTATIVE'),
      balance: newBalance,
      link: sendHash,
    }

    const hash = hashBlock(hashData)

    const signature = signBlock({ secretKey: privateKey, hash })

    const processRes = await this.httpService.axiosRef.post<
      { hash: string } | { error: string }
    >('/', {
      action: 'process',
      json_block: 'true',
      subtype: 'receive',
      block: {
        type: 'state',
        ...hashData,
        signature,
        work,
      },
    })

    if ('error' in processRes.data) throw new Error(processRes.data.error)

    return { hash: processRes.data.hash, newBalance }
  }

  private async getWorkForHash(hash: string) {
    const {
      data: { work },
    } = await this.httpService.axiosRef.get<NanotoPowResponse>(
      `https://nano.to/${hash}/pow`,
      { baseURL: undefined }
    )

    return work
  }
}
