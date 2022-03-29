
import {SigningCosmWasmClient, SigningCosmWasmClientOptions} from "@cosmjs/cosmwasm-stargate";
import {DirectSecp256k1Wallet, Registry} from "@cosmjs/proto-signing";
import {fromHex} from "@cosmjs/encoding";
import {
    MsgClearAdmin,
    MsgExecuteContract,
    MsgInstantiateContract,
    MsgMigrateContract,
    MsgStoreCode,
    MsgUpdateAdmin
} from "cosmjs-types/cosmwasm/wasm/v1/tx";
import {generateMnemonic, mnemonicToSeedSync} from "bip39";
import {fromSeed} from "bip32";
import {defaultRegistryTypes} from "@cosmjs/stargate";
import {MsgCreateVestingAccount, protobufPackage as vestingPackage} from "./codec/cosmos/vesting/v1beta1/tx";
import {MsgSuspend, MsgUnsuspend, protobufPackage as suspendPackage} from "./codec/nolus/suspend/v1beta1/tx";
import {QuerySuspendRequest} from "./codec/nolus/suspend/v1beta1/query";

let user1PrivKey = fromHex(process.env.USER_1_PRIV_KEY as string);
let user2PrivKey = fromHex(process.env.USER_2_PRIV_KEY as string);
let user3PrivKey = fromHex(process.env.USER_3_PRIV_KEY as string);
let delayedVestingPrivKey = fromHex(process.env.DELAYED_VESTING_PRIV_KEY as string);


export const NOLUS_PREFIX = "nolus";

export async function getWallet(privateKey: Uint8Array): Promise<DirectSecp256k1Wallet> {
    return await DirectSecp256k1Wallet.fromKey(privateKey, NOLUS_PREFIX);
}

export async function getClientWithKey(privateKey: Uint8Array): Promise<SigningCosmWasmClient> {
    const wallet = await getWallet(privateKey);
    return getClient(wallet);
}

export async function getClient(wallet: DirectSecp256k1Wallet): Promise<SigningCosmWasmClient> {
    return await SigningCosmWasmClient.connectWithSigner(process.env.NODE_URL as string, wallet, getSignerOptions());

}

export async function getUser1Wallet(): Promise<DirectSecp256k1Wallet> {
    return await getWallet(user1PrivKey);
}

export async function getUser2Wallet(): Promise<DirectSecp256k1Wallet> {
    return await getWallet(user2PrivKey);
}

export async function getUser3Wallet(): Promise<DirectSecp256k1Wallet> {
    return await getWallet(user3PrivKey);
}

export async function getUser1Client(): Promise<SigningCosmWasmClient> {
    return await getClientWithKey(user1PrivKey);
}

export async function getUser2Client(): Promise<SigningCosmWasmClient> {
    return await getClientWithKey(user2PrivKey);
}

export async function getUser3Client(): Promise<SigningCosmWasmClient> {
    return await getClientWithKey(user3PrivKey);
}


export async function createWallet(): Promise<DirectSecp256k1Wallet> {
    const privateKey = seedToPrivateKey(generateMnemonic(256))
    return await DirectSecp256k1Wallet.fromKey(privateKey, NOLUS_PREFIX)
}

function seedToPrivateKey(mnemonic: string, hdPath = 'm/44\'/118\'/0\'/0/0'): Buffer {
    const seed = mnemonicToSeedSync(mnemonic)
    const masterKey = fromSeed(seed)
    const {privateKey} = masterKey.derivePath(hdPath)
    if (privateKey === undefined) {
        throw new Error("Illegal state reached");
    }
    return privateKey
}

export async function getDelayedVestingWallet(): Promise<DirectSecp256k1Wallet> {
    return await getWallet(delayedVestingPrivKey);
}

export async function getDelayedVestingClient(): Promise<SigningCosmWasmClient> {
    return await getClientWithKey(delayedVestingPrivKey);
}

function getSignerOptions(): SigningCosmWasmClientOptions {
    // @ts-ignore
    const customRegistry = new Registry([
        ...defaultRegistryTypes,
        ["/cosmwasm.wasm.v1.MsgClearAdmin", MsgClearAdmin],
        ["/cosmwasm.wasm.v1.MsgExecuteContract", MsgExecuteContract],
        ["/cosmwasm.wasm.v1.MsgMigrateContract", MsgMigrateContract],
        ["/cosmwasm.wasm.v1.MsgStoreCode", MsgStoreCode],
        ["/cosmwasm.wasm.v1.MsgInstantiateContract", MsgInstantiateContract],
        ["/cosmwasm.wasm.v1.MsgUpdateAdmin", MsgUpdateAdmin],
        [`/${vestingPackage}.MsgCreateVestingAccount`, MsgCreateVestingAccount],
        [`/${suspendPackage}.MsgSuspend`, MsgSuspend],
        [`/${suspendPackage}.MsgUnsuspend`, MsgUnsuspend],
        [`/${suspendPackage}.QuerySuspendRequest`, QuerySuspendRequest],
    ]);
    return {registry: customRegistry}
}


