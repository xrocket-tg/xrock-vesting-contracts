import crypto from 'crypto';
import { Address, beginCell } from '@ton/core';

export function sha256Hash(input: string): bigint {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    const hashBuffer = hash.digest();
    const hashHex = hashBuffer.toString('hex');
    return BigInt('0x' + hashHex);
}

export function bufferToBigInt(x: Buffer) {
    return BigInt('0x' + x.toString('hex'));
}

export function bigIntToBuffer(x: bigint) {
    return Buffer.from(x.toString(16), 'hex');
}

export function getAddressBigInt(hash: bigint): Address {
    return beginCell().storeUint(4, 3).storeUint(0, 8).storeUint(hash, 256).endCell().beginParse().loadAddress();
}