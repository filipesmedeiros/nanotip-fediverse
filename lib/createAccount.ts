import {
    deriveAddress,
    generateSeed,
    derivePublicKey,
    deriveSecretKey,
} from "nanocurrency";

const generateRandomAddress = async () => {
    const seed = await generateSeed();
    const privateKey = deriveSecretKey(seed, 0);
    const publicKey = derivePublicKey(privateKey);
    const address = deriveAddress(publicKey, { useNanoPrefix: true });
    return {
        address,
        privateKey,
    };
};

export default generateRandomAddress;
