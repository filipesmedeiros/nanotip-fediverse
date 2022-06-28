import { convert, Unit } from "nanocurrency";
import { hashtag } from "./lib/constants";
import getMastodonAccount from "./lib/mastodon/getMastodonAccount";
import listenToToots from "./lib/mastodon/listenToToots";
import { Toot } from "./lib/mastodon/types";
import parseToot from "./lib/mastodon/parseToot";
import client from "./lib/prisma";
import Big from "big.js";
import sendToot from "./lib/mastodon/toot";
import getAddressAndPkFromIndex from "./lib/nano/getAddressAndPkFromIndex";
import sendFromCustodialAccount from "./lib/nano/sendBetweenAccounts";
import getNanoAccountInfo from "./lib/nano/getNanoAccountInfo";

const onToot = async (toot: Toot) => {
    try {
        const { amount, isCustodial } = parseToot(toot.content);

        const amountInRaw = convert(amount.toString(), {
            from: Unit.Nano,
            to: Unit.raw,
        });

        if (!isCustodial) return; // TODO

        const tipperAccount = await client().account.findUnique({
            where: { fediverseAccountId: toot.account.id },
        });

        if (!tipperAccount) {
            console.log("You have not created an account yet 🥲");
            sendToot("You have not created an account yet 🥲", toot.id); // TODO
            throw new Error("Account not found");
        }

        const { balance } = await getNanoAccountInfo(tipperAccount.nanoAddress);

        if (Big(amountInRaw).gt(balance)) {
            sendToot(
                "You don't have enough balance in your account 🥲",
                toot.id
            ); // TODO
            throw new Error("Not enough balance in account");
        }

        const replyToAccountId = toot.in_reply_to_account_id;
        const isReply = !!replyToAccountId;

        if (isReply) {
            const repliantMastodonAccount = await getMastodonAccount(
                replyToAccountId
            );
            let sendToAddress = repliantMastodonAccount.fields.find(
                ({ name }) => {
                    const nameLower = name.toLocaleUpperCase();
                    return (
                        nameLower === "XNO" ||
                        nameLower === "NANO" ||
                        nameLower === "Ӿ"
                    );
                }
            )?.value;

            if (!sendToAddress) {
                let repliantAccount = await client().account.findUnique({
                    where: { fediverseAccountId: replyToAccountId },
                });

                if (!repliantAccount) {
                    const index =
                        (
                            await client().account.findFirst({
                                orderBy: { nanoIndex: "desc" },
                            })
                        )?.nanoIndex ?? 0;
                    const { address } = getAddressAndPkFromIndex(index);
                    repliantAccount = await client().account.create({
                        data: {
                            fediverseAccountId: replyToAccountId,
                            nanoIndex: index,
                            nanoAddress: address,
                        },
                    });
                }

                const { privateKey } = getAddressAndPkFromIndex(
                    repliantAccount.nanoIndex
                );

                const hash = sendFromCustodialAccount({
                    amount: amountInRaw,
                    from: tipperAccount.nanoAddress,
                    to: repliantAccount.nanoAddress,
                    privateKey,
                });

                sendToot(
                    `<p>Created an <a href="https://nanolooker.com/account/${repliantAccount.nanoAddress}">account</a> for ${repliantMastodonAccount.display_name}</p>
                    <p>and <a href="https://nanolooker.com/block/${hash}">sent</a> Ӿ${amount} to it! ⚡️</p>`,
                    toot.id
                );
            }
        } else {
        }
    } catch (e) {
        console.error(e);
        return;
    }
};

const run = () => {
    listenToToots(onToot, hashtag);
};

run();
