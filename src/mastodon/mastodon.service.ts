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
    tippedUserHandle,
    amount,
  }: {
    replyToTootId: string
    newNanoAccount: string
    tippedUserHandle: string
    blockHash: string
    amount: number
  }) {
    this.toot(
      `Created an account (https://nanolooker.com/account/${newNanoAccount}) for ${tippedUserHandle} and sent Ӿ${amount} to it! ⚡️ https://nanolooker.com/block/${blockHash}`,
      replyToTootId
    )
  }

  private tootTipped({
    replyToTootId,
    blockHash,
    tippedUserHandle,
    amount,
  }: {
    replyToTootId: string
    tippedUserHandle: string
    blockHash: string
    amount: number
  }) {
    this.toot(
      `Tipped ${tippedUserHandle} Ӿ${amount}! ⚡️\n\nhttps://nanolooker.com/block/${blockHash}`,
      replyToTootId
    )
  }

  private tootNoBalance({
    tipperHandle,
    tipperAccountId,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperAccountId: string
    replyToTootId: string
  }) {
    this.logger.warn(
      `Mastodon user ${tipperAccountId} doesn't have enough balance to tip requested amount`
    )
    this.toot(
      `${tipperHandle}, you don't have enough balance in your account 🥲`,
      replyToTootId
    ) // TODO
  }

  private tootNanoAccountNotOpened({
    tipperHandle,
    tipperAccountId,
    nanoAccount,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperAccountId: string
    nanoAccount: string
    replyToTootId: string
  }) {
    this.logger.warn(
      `Mastodon user ${tipperAccountId} has not sent any fund to their account and are trying to tip`
    )
    this.toot(
      `${tipperHandle}, you haven't sent any nano to your account ${nanoAccount} (https://nanolooker.com/account/${nanoAccount}) 🧐\n\nPlease send some nano to it and try again ⚡️`,
      replyToTootId
    ) // TODO
  }

  private tootCreatedNewAccountForTipper({
    tipperHandle,
    tipperAccountId,
    newNanoAccount,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperAccountId: string
    newNanoAccount: string
    replyToTootId: string
  }) {
    this.logger.warn(
      `Mastodon user ${tipperAccountId} had not created an account yet. Created account with nano address ${newNanoAccount}`
    )
    this.toot(
      `${tipperHandle}, you hadn't created an account yet 🥺\n\nI created a new account with address ${newNanoAccount} (https://nanolooker.com/account/${newNanoAccount}) 🥳\n\nPlease send some nano to it and try again ⚡️`,
      replyToTootId
    )
  }

  private tootTootIsBadlyFormatted(replyToTootId: string) {
    this.logger.warn(`That toot is badly formatted`)
    this.toot(`That toot is badly formatted 😫`, replyToTootId) // TODO point to docs
  }

  private async getNanoAddressAndHandleFromAccountId(accountId: string) {
    const tippedUserAccount = await this.getMastodonAccount(accountId)
    const nanoAddress = tippedUserAccount.fields.find(({ name }) => {
      const nameLower = name.toLocaleUpperCase()
      return nameLower === 'XNO' || nameLower === 'NANO' || nameLower === 'Ӿ'
    })?.value

    return { nanoAddress, handle: `@${tippedUserAccount.acct}` }
  }

  private async onToot(toot: Toot) {
    this.logger.log(`Saw a toot with id ${toot.id}`)

    let amount: number,
      isNonCustodial: boolean,
      shouldSplitAmount: boolean,
      userIdsToTip: string[],
      replyToAccountId: string,
      shouldIgnoreReply: boolean

    try {
      ;({
        amount,
        isNonCustodial,
        shouldSplitAmount,
        userIdsToTip,
        replyToAccountId,
        shouldIgnoreReply,
      } = this.parseTipToot(toot))
    } catch {
      this.tootTootIsBadlyFormatted(toot.id)
      return
    }

    const amountInRaw = this.nanoService.nanoToRaw(amount)

    let tipperAccount = await this.accountsService.getAccount(toot.account.id)

    if (!tipperAccount) {
      tipperAccount = await this.accountsService.createAccount(toot.account.id)
      this.tootCreatedNewAccountForTipper({
        tipperHandle: `@${toot.account.acct}`,
        tipperAccountId: toot.account.id,
        newNanoAccount: tipperAccount.nanoAddress,
        replyToTootId: toot.id,
      })
    }

    let balance: string
    try {
      ;({ balance } = await this.nanoService.getNanoAccountInfo(
        tipperAccount.nanoAddress
      ))
    } catch {
      const receivables = await this.nanoService.getNanoAccountReceivables(
        tipperAccount.nanoAddress
      )
      const hasReceivables = Object.entries(receivables).length > 0
      if (!hasReceivables)
        this.tootNanoAccountNotOpened({
          tipperHandle: `@${toot.account.acct}`,
          tipperAccountId: toot.account.id,
          replyToTootId: toot.id,
          nanoAccount: tipperAccount.nanoAddress,
        })
      else {
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
        tipperAccountId: toot.account.id,
      })

    if (shouldIgnoreReply) {
      const tippedUsersCount = userIdsToTip.length

      const tipAmountToEachTippedUserInRaw = shouldSplitAmount
        ? Big(amountInRaw).div(tippedUsersCount).round().toString()
        : amountInRaw

      let cachedNanoInfo: {
        previousTipHash: string
        balanceAfterPreviousTip: string
      } = undefined

      for (const userId of userIdsToTip) {
        const tipResult = await this.tipUser({
          tippedUserAccountId: userId,
          amountInRaw: tipAmountToEachTippedUserInRaw,
          amountInNano: this.nanoService.rawToNano(
            tipAmountToEachTippedUserInRaw
          ),
          replyToTootId: toot.id,
          tipperNanoIndex: tipperAccount.nanoIndex,
          cachedNanoInfo,
          isNonCustodial,
        })

        cachedNanoInfo = {
          previousTipHash: tipResult.hash,
          balanceAfterPreviousTip: tipResult.newBalance,
        }
      }
    } else
      await this.tipUser({
        tippedUserAccountId: replyToAccountId,
        amountInRaw,
        amountInNano: amount,
        replyToTootId: toot.id,
        tipperNanoIndex: tipperAccount.nanoIndex,
        isNonCustodial,
      })
  }

  private async tipUser({
    amountInRaw,
    amountInNano,
    tippedUserAccountId,
    tipperNanoIndex,
    replyToTootId,
    cachedNanoInfo,
    isNonCustodial,
  }: {
    amountInRaw: string
    amountInNano: number
    tippedUserAccountId: string
    tipperNanoIndex: number
    replyToTootId: string
    cachedNanoInfo?: {
      previousTipHash: string
      balanceAfterPreviousTip: string
    }
    isNonCustodial?: boolean
  }) {
    const info = await this.getNanoAddressAndHandleFromAccountId(
      tippedUserAccountId
    )
    let tippedUserNanoAddress = info.nanoAddress
    const tippedUserHandle = info.handle

    let createdAccountForTippedUser = false

    if (!tippedUserNanoAddress) {
      let tippedUserAccount = await this.accountsService.getAccount(
        tippedUserAccountId
      )

      if (!tippedUserAccount) {
        createdAccountForTippedUser = true
        tippedUserAccount = await this.accountsService.createAccount(
          tippedUserAccountId
        )
      }

      tippedUserNanoAddress = tippedUserAccount.nanoAddress
    }

    const { privateKey: tipperNanoPrivateKey, address: tipperNanoAddress } =
      this.nanoService.getAddressAndPkFromIndex(tipperNanoIndex)

    const nanoInfoAfterSend = await this.nanoService.sendNano({
      amount: amountInRaw,
      from: tipperNanoAddress,
      to: tippedUserNanoAddress,
      privateKey: tipperNanoPrivateKey,
      cachedInfo: cachedNanoInfo
        ? {
            frontier: cachedNanoInfo.previousTipHash,
            balance: cachedNanoInfo.balanceAfterPreviousTip,
          }
        : undefined,
    })

    const tootParams = {
      blockHash: nanoInfoAfterSend.hash,
      amount: amountInNano,
      replyToTootId,
      tippedUserHandle,
    }

    if (createdAccountForTippedUser)
      this.tootCreatedAccountAndTipped({
        ...tootParams,
        newNanoAccount: tippedUserNanoAddress,
      })
    else this.tootTipped(tootParams)

    return nanoInfoAfterSend
  }

  private async toot(status: string, inReplyTo?: string) {
    const tootRes = await this.httpService.axiosRef.post<Toot>('/statuses', {
      status,
      in_reply_to_id: inReplyTo,
    })

    if (tootRes.status >= 300) throw new Error(tootRes.statusText)

    return tootRes.data
  }

  private parseTipToot(toot: Toot) {
    const content = new JSDOM(toot.content)
    const firstLine = content.window.document.querySelector('p')
    const textContent = firstLine?.textContent

    if (!textContent) throw new Error('Toot is badly formatted')

    const parts = textContent.split(' ')
    const amount = parts.find(part => !isNaN(+part) && +part !== 0)

    if (!amount) throw new Error('Toot is badly formatted')

    const isNonCustodial = parts.includes('non-custodial')
    const shouldSplitAmount = parts.includes('split')
    const replyToAccountId = toot.in_reply_to_account_id
    const userIdsToTip = toot.mentions.map(({ id }) => id)
    const shouldIgnoreReply =
      (toot.mentions.length > 1 &&
        toot.mentions[0].id === toot.in_reply_to_account_id) ||
      !replyToAccountId

    return {
      amount: +amount,
      isNonCustodial,
      userIdsToTip,
      shouldSplitAmount,
      replyToAccountId,
      shouldIgnoreReply,
    }
  }

  private parseSignatureToot(toot: Toot) {
    const content = new JSDOM(toot.content)
    const firstLine = content.window.document.querySelector('p')
    const textContent = firstLine?.textContent

    if (!textContent) throw new Error('Toot is badly formatted')

    const parts = textContent.split(' ')
    const amount = parts.find(part => !isNaN(+part) && +part !== 0)

    if (!amount) throw new Error('Toot is badly formatted')

    const isCustodial = !parts.includes('non-custodial')
    const shouldSplitAmount = parts.includes('split')
    const replyToAccountId = toot.in_reply_to_account_id
    const userIdsToTip = toot.mentions.map(({ id }) => id)
    const shouldIgnoreReply =
      (toot.mentions.length > 1 &&
        toot.mentions[0].id === toot.in_reply_to_account_id) ||
      !replyToAccountId

    return {
      amount: +amount,
      isCustodial,
      userIdsToTip,
      shouldSplitAmount,
      replyToAccountId,
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
