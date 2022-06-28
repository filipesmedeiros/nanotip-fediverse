import { JSDOM } from "jsdom";

const parseToot = (text: string) => {
    const content = new JSDOM(text);
    const firstLine = content.window.document.querySelector("p");
    const textContent = firstLine?.textContent;

    if (!textContent) throw new Error("Toot is badly formatted");

    console.log(textContent);

    const parts = textContent.split(" ");
    const amount = parts.find((part) => !isNaN(+part) && +part !== 0);

    if (!amount) throw new Error("Toot is badly formatted");

    const isCustodial = !parts.includes("non-custodial");

    return { amount: +amount, isCustodial };
};

export default parseToot;
