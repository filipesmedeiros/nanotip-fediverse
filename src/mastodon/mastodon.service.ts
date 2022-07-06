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
import { checkAddress, hashBlock } from 'nanocurrency'
import { MessageEvent, WebSocket } from 'ws'

import { AccountsService } from '@app/accounts/accounts.service'
import { Config } from '@app/lib/types'
import { Account, FediverseEvent, Toot } from '@app/mastodon/lib/mastodon.types'
import { NanoService } from '@app/nano/nano.service'

@Injectable()
export class MastodonService implements OnModuleInit {
  private ws: WebSocket
  private readonly logger = new Logger(MastodonService.name)
  private nanoTipperAccount: Account
  private isSilent: boolean

  constructor(
    private httpService: HttpService,
    private configService: ConfigService<Config>,
    @Inject(forwardRef(() => NanoService))
    private nanoService: NanoService,
    @Inject(forwardRef(() => AccountsService))
    private accountsService: AccountsService
  ) {}

  async onModuleInit() {
    this.nanoTipperAccount = await this.getMyAccount()
    this.isSilent = this.configService.get('SILENT') ?? false

    this.connectWebsocket()
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
    if (!this.isSilent)
      return this.toot(
        `Created an account (https://nanolooker.com/account/${newNanoAccount}) for ${tippedUserHandle} and sent Ӿ${amount} to it! ⚡️ https://nanolooker.com/block/${blockHash}`,
        replyToTootId
      )
    else return this.favorite(replyToTootId)
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
    if (!this.isSilent)
      return this.toot(
        `Tipped ${tippedUserHandle} Ӿ${amount}! ⚡️\n\nhttps://nanolooker.com/block/${blockHash}`,
        replyToTootId
      )
    else return this.favorite(replyToTootId)
  }

  private privateTootWithdrew({
    userHandle,
    replyToTootId,
    blockHash,
    amount,
  }: {
    userHandle: string
    replyToTootId: string
    blockHash: string
    amount: number
  }) {
    if (!this.isSilent)
      return this.toot(
        `${userHandle}, withdrew Ӿ${amount}! 🤑\n\nhttps://nanolooker.com/block/${blockHash}`,
        replyToTootId,
        { direct: true }
      )
    else return this.favorite(replyToTootId)
  }

  private privateTootAddress({
    userHandle,
    replyToTootId,
    address,
  }: {
    userHandle: string
    replyToTootId: string
    address: string
  }) {
    return this.toot(
      `${userHandle}, your tip bot address is https://nanolooker.com/account/${address}`,
      replyToTootId,
      { direct: true }
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
    if (!this.isSilent) {
      this.logger.warn(
        `Mastodon user ${tipperAccountId} doesn't have enough balance to tip requested amount`
      )
      return this.toot(
        `${tipperHandle}, you don't have enough balance in your account 🥲`,
        replyToTootId
      ) // TODO
    } else return this.favorite(replyToTootId)
  }

  private tootBlockInfo({
    tippedUserNanoAddress,
    replyToTootId,
    tipperNanoAddress,
    newBalance,
    representative,
    amount,
    tippedUserHandle,
    blockHash,
    previousHash,
  }: {
    tippedUserNanoAddress: string
    replyToTootId: string
    tipperNanoAddress: string
    newBalance: string
    representative: string
    blockHash: string
    tippedUserHandle: string
    amount: number
    previousHash: string
  }) {
    return this.toot(
      `Please sign this hash: ${blockHash}\n\nTip info: ${JSON.stringify({
        rep: representative,
        balance: newBalance,
        amount,
        tippedUser: tippedUserHandle,
        from: tipperNanoAddress,
        to: tippedUserNanoAddress,
        preivous: previousHash,
      })}`,
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
    if (!this.isSilent) {
      this.logger.warn(
        `Mastodon user ${tipperAccountId} has not sent any fund to their account and are trying to tip`
      )
      return this.toot(
        `${tipperHandle}, you haven't sent any nano to your account ${nanoAccount} (https://nanolooker.com/account/${nanoAccount}) 🧐\n\nPlease send some nano to it and try again ⚡️`,
        replyToTootId
      ) // TODO
    } else return this.favorite(replyToTootId)
  }

  private tootNoNanoAccountInProfile({
    tipperHandle,
    tipperAccountId,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperAccountId: string
    replyToTootId: string
  }) {
    if (!this.isSilent) {
      this.logger.warn(
        `${tipperAccountId} is trying to tip non-custodial and doesn't have an address in their account`
      )
      return this.toot(
        `${tipperHandle}, to tip non-custodially, you must have a nano account in your profile 🤯`,
        replyToTootId
      ) // TODO link to docs
    } else return this.favorite(replyToTootId)
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
    if (!this.isSilent) {
      this.logger.warn(
        `Mastodon user ${tipperAccountId} had not created an account yet. Created account with nano address ${newNanoAccount}`
      )
      return this.toot(
        `${tipperHandle}, you hadn't created an account yet 🥺\n\nI created a new account with address ${newNanoAccount} (https://nanolooker.com/account/${newNanoAccount}) 🥳\n\nPlease send some nano to it and try again ⚡️`,
        replyToTootId
      )
    } else return this.favorite(replyToTootId)
  }

  private tootTootIsBadlyFormatted(replyToTootId: string) {
    if (!this.isSilent) {
      this.logger.warn(`Toot ${replyToTootId} is badly formatted`)
      return this.toot(`That toot is badly formatted 😫`, replyToTootId) // TODO point to docs
    } else return this.favorite(replyToTootId)
  }

  private tootNonCustodialMustBeSingleTip({
    tipperHandle,
    tipperAccountId,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperAccountId: string
    replyToTootId: string
  }) {
    if (!this.isSilent) {
      this.logger.warn(
        `User ${tipperAccountId} tried to non-custodially tip multiple users`
      )
      return this.toot(
        `${tipperHandle}, tipping multiple people non-custodially is not supported`,
        replyToTootId
      ) // TODO point to docs
    } else return this.favorite(replyToTootId)
  }

  private async getNanoAddressAndHandleFromAccountId(accountId: string) {
    const account = await this.getMastodonAccount(accountId)
    let nanoAddress = account.fields.find(({ name }) => {
      const nameUpper = name.toLocaleUpperCase()
      return nameUpper === 'XNO' || nameUpper === 'NANO' || nameUpper === 'Ӿ'
    })?.value

    if (nanoAddress?.startsWith('nano://'))
      nanoAddress = nanoAddress.substring(7)
    else if (nanoAddress?.startsWith('nano:'))
      nanoAddress = nanoAddress.substring(5)

    return { nanoAddress, handle: `@${account.acct}` }
  }

  private async getMyAccount() {
    const { data } = await this.httpService.axiosRef.get<Account>(
      '/accounts/verify_credentials'
    )
    return data
  }

  private async getToot(tootId: string) {
    const { data } = await this.httpService.axiosRef.get<Toot>(
      `/statuses/${tootId}`
    )
    return data
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
      await this.tootTootIsBadlyFormatted(toot.id)
      return
    }

    if (isNonCustodial && userIdsToTip.length > 1)
      await this.tootNonCustodialMustBeSingleTip({
        tipperHandle: `@${toot.account.acct}`,
        tipperAccountId: toot.account.id,
        replyToTootId: toot.id,
      })

    const amountInRaw = this.nanoService.nanoToRaw(amount)

    let tipperNanoAddress: string
    let tipperNanoIndex: number

    if (!isNonCustodial) {
      let tipperAccount = await this.accountsService.getAccount(toot.account.id)

      if (!tipperAccount) {
        tipperAccount = await this.accountsService.createAccount(
          toot.account.id
        )
        await this.tootCreatedNewAccountForTipper({
          tipperHandle: `@${toot.account.acct}`,
          tipperAccountId: toot.account.id,
          newNanoAccount: tipperAccount.nanoAddress,
          replyToTootId: toot.id,
        })
      }

      ;({ nanoAddress: tipperNanoAddress, nanoIndex: tipperNanoIndex } =
        tipperAccount)
    } else {
      tipperNanoAddress = (
        await this.getNanoAddressAndHandleFromAccountId(toot.account.id)
      ).nanoAddress
    }

    let balance: string
    try {
      ;({ balance } = await this.nanoService.getNanoAccountInfo(
        tipperNanoAddress
      ))
    } catch {
      const receivables = await this.nanoService.getNanoAccountReceivables(
        tipperNanoAddress
      )
      const hasReceivables = Object.entries(receivables).length > 0
      if (!hasReceivables)
        await this.tootNanoAccountNotOpened({
          tipperHandle: `@${toot.account.acct}`,
          tipperAccountId: toot.account.id,
          replyToTootId: toot.id,
          nanoAccount: tipperNanoAddress,
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
      await this.tootNoBalance({
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
          tipperNanoIndex: tipperNanoIndex,
          tipperAccountId: toot.account.id,
          cachedNanoInfo,
          isNonCustodial,
        })

        if (!isNonCustodial)
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
        tipperNanoIndex: tipperNanoIndex,
        tipperAccountId: toot.account.id,
        isNonCustodial,
      })
  }

  private async onDirectToot(toot: Toot) {
    this.logger.log(`Received direct toot ${toot.id}`)

    const parsed = this.parseDirectToot(toot)

    const { nanoIndex } = await this.accountsService.getAccount(toot.account.id)

    const { address: accountAddress, privateKey } =
      this.nanoService.getAddressAndPkFromIndex(nanoIndex)

    if (parsed.type === 'address') {
      await this.privateTootAddress({
        replyToTootId: toot.id,
        address: accountAddress,
        userHandle: `@${toot.account.acct}`,
      })
    } else {
      const { address, amount } = parsed

      const amountToWithdraw = amount
        ? this.nanoService.nanoToRaw(amount)
        : (
            await this.nanoService.getNanoAccountInfo(accountAddress, {
              balanceIncludeReceivable: true,
            })
          ).balance

      const { nanoAddress } = await this.getNanoAddressAndHandleFromAccountId(
        toot.account.id
      )

      if (!address && !nanoAddress)
        throw new Error('Trying to withdraw without specifying address')

      const { hash } = await this.nanoService.sendNano({
        from: accountAddress,
        to: nanoAddress ?? address,
        amount: amountToWithdraw,
        privateKey,
      })

      await this.privateTootWithdrew({
        blockHash: hash,
        replyToTootId: toot.id,
        amount: this.nanoService.rawToNano(amountToWithdraw),
        userHandle: `@${toot.account.acct}`,
      })
    }
  }

  private async onReply(toot: Toot) {
    this.logger.log(
      `Someone replied to toot ${toot.in_reply_to_id} with id ${toot.id}`
    )

    const { signature } = this.parseSignatureToot(toot)

    const blockInfoToot = await this.getToot(toot.in_reply_to_id)

    const {
      from: tipperNanoAddress,
      to: tippedUserNanoAddress,
      rep: representative,
      balance: newBalance,
      preivous: previousHash,
      tippedUser: tippedUserHandle,
      amount,
    } = this.parseBlockInfoToot(blockInfoToot)

    const hash = await this.nanoService.sendSignedNano({
      from: tipperNanoAddress,
      to: tippedUserNanoAddress,
      representative,
      balance: newBalance,
      previous: previousHash,
      signature,
    })

    await this.tootTipped({
      blockHash: hash,
      tippedUserHandle,
      amount,
      replyToTootId: toot.id,
    })
  }

  private async tipUser({
    amountInRaw,
    amountInNano,
    tippedUserAccountId,
    tipperNanoIndex,
    tipperAccountId,
    replyToTootId,
    cachedNanoInfo,
    isNonCustodial,
  }: {
    amountInRaw: string
    amountInNano: number
    tippedUserAccountId: string
    tipperNanoIndex: number
    tipperAccountId: string
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

    if (isNonCustodial) {
      const { nanoAddress: tipperNanoAddress, handle: tipperHandle } =
        await this.getNanoAddressAndHandleFromAccountId(tipperAccountId)

      if (!tipperNanoAddress)
        await this.tootNoNanoAccountInProfile({
          tipperHandle,
          replyToTootId,
          tipperAccountId,
        })
      else {
        const { representative, frontier, balance } =
          await this.nanoService.getNanoAccountInfo(tipperNanoAddress, {
            balanceIncludeReceivable: true,
          })

        const newBalance = Big(balance).minus(amountInRaw).toString()

        await Promise.all([
          this.followAccount(tipperAccountId),
          this.tootBlockInfo({
            tippedUserNanoAddress,
            replyToTootId,
            blockHash: hashBlock({
              representative,
              balance: newBalance,
              account: tipperNanoAddress,
              link: tippedUserNanoAddress,
              previous: frontier,
            }),
            tipperNanoAddress,
            newBalance,
            representative,
            previousHash: frontier,
            amount: amountInNano,
            tippedUserHandle,
          }),
        ])
      }
    } else {
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
        await this.tootCreatedAccountAndTipped({
          ...tootParams,
          newNanoAccount: tippedUserNanoAddress,
        })
      else await this.tootTipped(tootParams)

      return nanoInfoAfterSend
    }
  }

  private followAccount(accountId: string) {
    return this.httpService.axiosRef.post(`/accounts/${accountId}/follow`)
  }

  private async toot(
    status: string,
    inReplyTo?: string,
    { direct = false }: { direct: boolean } = { direct: false }
  ) {
    const tootRes = await this.httpService.axiosRef.post<Toot>('/statuses', {
      status,
      in_reply_to_id: inReplyTo,
      visibility: direct ? 'direct' : 'public',
    })
    if (tootRes.status >= 300) throw new Error(tootRes.statusText)

    return tootRes.data
  }

  private async favorite(tootId: string) {
    const tootRes = await this.httpService.axiosRef.post<Toot>(
      `/statuses/${tootId}/favourite`
    )
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
    const content = new JSDOM(toot.content).window.document.querySelector('p')
    const textContent = content?.textContent

    if (!textContent) throw new Error('Toot is badly formatted')

    const signature = textContent.split(' ').at(-1)

    if (!this.nanoService.validateSignature(signature))
      throw new Error('Toot is badly formatted')

    return { signature }
  }

  private parseDirectToot(
    toot: Toot
  ):
    | { type: 'address' }
    | { type: 'withdraw'; amount: number; address: string } {
    const content = new JSDOM(toot.content).window.document.querySelector('p')
    const textContent = content?.textContent

    if (!textContent) throw new Error('Toot is badly formatted')

    const parts = textContent.split(' ')

    const amount = parts.find(part => !isNaN(+part) && +part !== 0)
    const address = parts.find(part => checkAddress(part))

    if (parts.includes('withdraw')) {
      return { type: 'withdraw', amount: +amount, address }
    } else if (parts.includes('address')) {
      return { type: 'address' }
    } else throw new Error('Toot is badly formatted')
  }

  private parseBlockInfoToot(toot: Toot) {
    const content = new JSDOM(toot.content).window.document.querySelector(
      'body'
    )
    const textContent = content?.textContent

    if (!textContent) throw new Error('Toot is badly formatted')

    const blockInfo: {
      rep: string
      balance: string
      amount: number
      tippedUser: string
      from: string
      to: string
      preivous: string
    } = JSON.parse(textContent.split('Tip info: ')[1])

    return blockInfo
  }
  private async getMastodonAccount(id: string) {
    const accountRes = await this.httpService.axiosRef.get<Account>(
      `/accounts/${id}`
    )

    if (accountRes.status >= 300) throw new Error(accountRes.statusText)

    return accountRes.data
  }

  private connectWebsocket() {
    const wsUrl = `${this.configService.get(
      'MASTODON_STREAMING_BASE_URL'
    )}?access_token=${this.configService.get('MASTODON_ACCESS_TOKEN')}`

    this.ws = new WebSocket(wsUrl)
    this.ws.onclose = () => {
      this.logger.warn('Websocket connection closed')
      this.connectWebsocket()
    }
    this.ws.onopen = async () => {
      this.logger.log('Websocket connection opened')

      this.listenToNotifications()
      this.listenToToots()
    }

    const messageHandler = async (ev: MessageEvent) => {
      try {
        if (typeof ev.data !== 'string') return

        const event: FediverseEvent = JSON.parse(ev.data)

        if (event.event !== 'update') return

        const toot: Toot = JSON.parse(event.payload)

        if (event.stream.includes('hashtag')) await this.onToot(toot)
        else if (event.stream.includes('user')) {
          if (
            toot.account.id !== this.nanoTipperAccount.id &&
            toot.in_reply_to_account_id === this.nanoTipperAccount.id
          )
            await this.onReply(toot)
          else if (
            toot.visibility === 'direct' &&
            toot.account.id !== this.nanoTipperAccount.id
          ) {
            await this.onDirectToot(toot)
          }
        }
      } catch (e) {
        // any errors I forgot to catch fall in here :)
        this.logger.error(e)
      }
    }

    this.ws.onmessage = messageHandler
  }

  private async listenToNotifications() {
    this.logger.log('Listening to notifications')

    this.ws.send(
      JSON.stringify({
        type: 'subscribe',
        stream: 'user',
      })
    )
  }

  private listenToToots() {
    this.logger.log('Listening to toots with hashtag')

    this.ws.send(
      JSON.stringify({
        type: 'subscribe',
        stream: 'hashtag',
        tag: this.configService.get('MASTODON_TRIGGER_HASHTAG'),
      })
    )
  }
}
