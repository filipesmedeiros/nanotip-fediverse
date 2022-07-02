import { HttpService } from '@nestjs/axios'
import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Big from 'big.js'
import { JSDOM } from 'jsdom'
import { Unit, convert } from 'nanocurrency'
import { MessageEvent, WebSocket } from 'ws'

import { AccountsService } from '@app/accounts/accounts.service'
import { Config } from '@app/lib/types'
import { Account, Toot } from '@app/mastodon/lib/mastodon.types'
import { NanoService } from '@app/nano/nano.service'

@Injectable()
export class MastodonService implements OnModuleInit {
  private ws: WebSocket
  private mastodonStreamingBaseUrlWithToken: string
  private readonly logger = new Logger(MastodonService.name)

  constructor(
    private httpService: HttpService,
    private configService: ConfigService<Config>,
    @Inject(forwardRef(() => NanoService))
    private nanoService: NanoService,
    @Inject(forwardRef(() => AccountsService))
    private accountsService: AccountsService
  ) {
    this.mastodonStreamingBaseUrlWithToken = `${this.configService.get(
      'MASTODON_STREAMING_BASE_URL'
    )}?access_token=${this.configService.get('MASTODON_ACCESS_TOKEN')}`
  }

  onModuleInit() {
    this.listenToToots(toot => {
      try {
        this.onToot(toot)
      } catch {} // TODO
    }, this.configService.get('MASTODON_TRIGGER_HASHTAG'))
  }

  private tootCreatedAccountAndTipped({
    replyToTootId,
    newNanoAccount,
    blockHash,
    tippedUserDisplayName,
    amount,
  }: {
    replyToTootId: string
    newNanoAccount: string
    tippedUserDisplayName: string
    blockHash: string
    amount: number
  }) {
    this.toot(
      `Created an account (https://nanolooker.com/account/${newNanoAccount}) for ${tippedUserDisplayName} and sent Ӿ${amount} to it! ⚡️ https://nanolooker.com/block/${blockHash}`,
      replyToTootId
    )
  }

  private tootTipped({
    replyToTootId,
    blockHash,
    tippedUserDisplayName,
    amount,
  }: {
    replyToTootId: string
    tippedUserDisplayName: string
    blockHash: string
    amount: number
  }) {
    this.toot(
      `Tipped ${tippedUserDisplayName} Ӿ${amount}! ⚡️ https://nanolooker.com/block/${blockHash}`,
      replyToTootId
    )
  }

  private tootNoBalance({
    tipperHandle,
    tipperFediverseAccountId,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperFediverseAccountId: string
    replyToTootId: string
  }) {
    this.logger.warn(
      `Mastodon user ${tipperFediverseAccountId} doesn't have enough balance to tip requested amount`
    )
    this.toot(
      `${tipperHandle}, you don't have enough balance in your account 🥲`,
      replyToTootId
    ) // TODO
  }

  private tootNanoAccountNotOpened({
    tipperHandle,
    tipperFediverseAccountId,
    nanoAccount,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperFediverseAccountId: string
    nanoAccount: string
    replyToTootId: string
  }) {
    this.logger.warn(
      `Mastodon user ${tipperFediverseAccountId} has not sent any fund to their account and are trying to tip`
    )
    this.toot(
      `${tipperHandle}, you haven't sent any nano to your account ${nanoAccount} (https://nanolooker.com/account/${nanoAccount}) 🧐\n\nPlease send some nano to it and try again ⚡️`,
      replyToTootId
    ) // TODO
  }

  private tootCreatedNewAccountForTipper({
    tipperHandle,
    tipperFediverseAccountId,
    newNanoAccount,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperFediverseAccountId: string
    newNanoAccount: string
    replyToTootId: string
  }) {
    this.logger.warn(
      `Mastodon user ${tipperFediverseAccountId} had not created an account yet. Created account with nano address ${newNanoAccount}`
    )
    this.toot(
      `${tipperHandle}, you hadn't created an account yet 🥺\n\nI created a new account with address ${newNanoAccount} (https://nanolooker.com/account/${newNanoAccount}) 🥳\n\nPlease send some nano to it and try again ⚡️`,
      replyToTootId
    )
  }

  private tootTootIsBadlyFormatted(replyToTootId: string) {
    this.logger.warn(`That toot is badly formatted`)
    this.toot(`Toot ${replyToTootId} is badly formatted 😫`, replyToTootId)
  }

  private async getNanoAddressAndDisplayNameFromFediverseAccountId(
    fediverseAccountId: string
  ) {
    const tippedUserFediverseAccount = await this.getMastodonAccount(
      fediverseAccountId
    )
    const nanoAddress = tippedUserFediverseAccount.fields.find(({ name }) => {
      const nameLower = name.toLocaleUpperCase()
      return nameLower === 'XNO' || nameLower === 'NANO' || nameLower === 'Ӿ'
    })?.value

    return { nanoAddress, displayName: tippedUserFediverseAccount.display_name }
  }

  private async onToot(toot: Toot) {
    this.logger.log(`Saw a toot with id ${toot.id}`)

    let amount: number,
      isCustodial: boolean,
      shouldSplitAmount: boolean,
      userIdsToTip: string[],
      replyToFediverseAccountId: string,
      shouldIgnoreReply: boolean

    try {
      ;({
        amount,
        isCustodial,
        shouldSplitAmount,
        userIdsToTip,
        replyToFediverseAccountId,
        shouldIgnoreReply,
      } = this.parseToot(toot))
    } catch {
      this.tootTootIsBadlyFormatted(toot.id)
      return
    }

    const amountInRaw = this.nanoService.nanoToRaw(amount)

    if (!isCustodial) return // TODO

    let tipperAccount = await this.accountsService.getAccount(toot.account.id)

    if (!tipperAccount) {
      tipperAccount = await this.accountsService.createAccount(toot.account.id)
      this.tootCreatedNewAccountForTipper({
        tipperHandle: `@${toot.account.acct}`,
        tipperFediverseAccountId: toot.account.id,
        newNanoAccount: tipperAccount.nanoAddress,
        replyToTootId: toot.id,
      })
    }

    let balance: string
    try {
      ;({ balance } = await this.nanoService.getNanoAccountInfo({
        account: tipperAccount.nanoAddress,
      }))
    } catch {
      const receivables = await this.nanoService.getNanoAccountReceivables(
        tipperAccount.nanoAddress
      )
      const hasReceivables = Object.entries(receivables).length > 0
      if (!hasReceivables)
        this.tootNanoAccountNotOpened({
          tipperHandle: `@${toot.account.acct}`,
          tipperFediverseAccountId: toot.account.id,
          replyToTootId: toot.id,
          nanoAccount: tipperAccount.nanoAddress,
        })
      else {
        Big.PE = 50
        balance = Object.entries(receivables)
          .reduce((acc, nextReceivable) => {
            return Big(acc).plus(nextReceivable[1].amount)
          }, Big(0))
          .toString()
      }
    }

    if (Big(amountInRaw).gt(balance))
      this.tootNoBalance({
        tipperHandle: `@${toot.account.acct}`,
        replyToTootId: toot.id,
        tipperFediverseAccountId: toot.account.id,
      })

    if (shouldIgnoreReply) {
      const tippedUsersCount = userIdsToTip.length
      const tipAmountToEachTippedUserInNano = shouldSplitAmount
        ? Math.round(amount / tippedUsersCount)
        : amount
      const tipAmountToEachTippedUserInraw = this.nanoService.nanoToRaw(
        tipAmountToEachTippedUserInNano
      )

      for (const userId of userIdsToTip)
        this.tipUser({
          tippedUserFediverseAccountId: userId,
          amountInRaw: tipAmountToEachTippedUserInraw,
          amountInNano: tipAmountToEachTippedUserInNano,
          replyToTootId: toot.id,
          tipperNanoIndex: tipperAccount.nanoIndex,
          fastSends: true,
        })
    } else
      await this.tipUser({
        tippedUserFediverseAccountId: replyToFediverseAccountId,
        amountInRaw,
        amountInNano: amount,
        replyToTootId: toot.id,
        tipperNanoIndex: tipperAccount.nanoIndex,
      })
  }

  private async tipUser({
    amountInRaw,
    amountInNano,
    tippedUserFediverseAccountId,
    tipperNanoIndex,
    replyToTootId,
    fastSends,
  }: {
    amountInRaw: string
    amountInNano: number
    tippedUserFediverseAccountId: string
    tipperNanoIndex: number
    replyToTootId: string
    fastSends?: boolean
  }) {
    const info = await this.getNanoAddressAndDisplayNameFromFediverseAccountId(
      tippedUserFediverseAccountId
    )
    let tippedUserNanoAddress = info.nanoAddress
    const tippedUserDisplayName = info.displayName

    let createdAccountForTippedUser = false

    if (!tippedUserNanoAddress) {
      let tippedUserAccount = await this.accountsService.getAccount(
        tippedUserFediverseAccountId
      )

      if (!tippedUserAccount) {
        createdAccountForTippedUser = true
        tippedUserAccount = await this.accountsService.createAccount(
          tippedUserFediverseAccountId
        )
      }

      tippedUserNanoAddress = tippedUserAccount.nanoAddress
    }

    const { privateKey: tipperNanoPrivateKey, address: tipperNanoAddress } =
      this.nanoService.getAddressAndPkFromIndex(tipperNanoIndex)

    const hash = await this.nanoService.sendNano({
      amount: amountInRaw,
      from: tipperNanoAddress,
      to: tippedUserNanoAddress,
      privateKey: tipperNanoPrivateKey,
      useUnconfirmedInfo: fastSends,
    })

    const tootParams = {
      blockHash: hash,
      amount: amountInNano,
      replyToTootId,
      tippedUserDisplayName: tippedUserDisplayName,
    }

    if (createdAccountForTippedUser)
      this.tootCreatedAccountAndTipped({
        ...tootParams,
        newNanoAccount: tippedUserNanoAddress,
      })
    else this.tootTipped(tootParams)
  }

  private async toot(status: string, inReplyTo?: string) {
    const tootRes = await this.httpService.axiosRef.post<Toot>('/statuses', {
      status,
      in_reply_to_id: inReplyTo,
    })

    if (tootRes.status >= 300) throw new Error(tootRes.statusText)

    return tootRes.data
  }

  private parseToot(toot: Toot) {
    const content = new JSDOM(toot.content)
    const firstLine = content.window.document.querySelector('p')
    const textContent = firstLine?.textContent

    if (!textContent) throw new Error('Toot is badly formatted')

    const parts = textContent.split(' ')
    const amount = parts.find(part => !isNaN(+part) && +part !== 0)

    if (!amount) throw new Error('Toot is badly formatted')

    const isCustodial = !parts.includes('non-custodial')
    const shouldSplitAmount = !parts.includes('split')
    const replyToFediverseAccountId = toot.in_reply_to_account_id
    const userIdsToTip = toot.mentions.map(({ id }) => id)
    const shouldIgnoreReply =
      (toot.mentions.length > 1 &&
        toot.mentions[0].id === toot.in_reply_to_account_id) ||
      !replyToFediverseAccountId

    return {
      amount: +amount,
      isCustodial,
      userIdsToTip,
      shouldSplitAmount,
      replyToFediverseAccountId,
      shouldIgnoreReply,
    }
  }

  private async getMastodonAccount(id: string) {
    const accountRes = await this.httpService.axiosRef.get<Account>(
      `/accounts/${id}`
    )

    if (accountRes.status >= 300) throw new Error(accountRes.statusText)

    return accountRes.data
  }

  private listenToToots(onToot: (toot: Toot) => void, tag?: string) {
    const wsUrl = tag
      ? `${this.mastodonStreamingBaseUrlWithToken}&stream=hashtag:local&tag=${tag}`
      : `${this.mastodonStreamingBaseUrlWithToken}&stream=public`

    const messageHandler = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return

      const data = JSON.parse(ev.data as string)
      if (data.event !== 'update') return

      const toot = JSON.parse(data.payload)

      onToot(toot)
    }

    this.ws = new WebSocket(wsUrl)

    this.ws.onclose = () => (this.ws = new WebSocket(wsUrl))
    this.ws.onopen = () => this.ws.addEventListener('message', messageHandler)
  }
}
