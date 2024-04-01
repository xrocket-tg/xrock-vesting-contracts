import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { OPCODES } from './Config';

export type JettonLockupConfig = {
    adminAddress: Address;
    claimerAddress: Address;
};

export type LockupData = {
    init: boolean;
    adminAddress: Address;
    claimerAddress: Address;
    tokenBalance: bigint;
    tokenClaimed: bigint;
    lastClaimed: number;
};

export type VestingData = {
    jettonWalletAddress: Address;
    cliffEndDate: number;
    cliffNumerator: number;
    cliffDenominator: number;
    vestingPeriod: number;
    vestingNumerator: number;
    vestingDenominator: number;
    unlocksCount: number;
};

export type ExtendedVestingData = VestingData & {
    cliffUnlockAmount: bigint;
    vestingUnlockAmount: bigint;
};

export type InitData = VestingData & {
    tokenBalance: bigint;
};

export function jettonLockupConfigToCell(config: JettonLockupConfig): Cell {
    return beginCell().storeAddress(config.adminAddress).storeAddress(config.claimerAddress).endCell();
}

export class JettonLockup implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new JettonLockup(address);
    }

    static createFromConfig(config: JettonLockupConfig, code: Cell, workchain = 0) {
        const data = jettonLockupConfigToCell(config);
        const init = { code, data };
        return new JettonLockup(contractAddress(workchain, init), init);
    }

    async sendDeploy(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        tokenBalance: bigint,
        vestingData: VestingData,
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeCoins(tokenBalance)
                .storeAddress(vestingData.jettonWalletAddress)
                .storeUint(vestingData.cliffEndDate, 32)
                .storeUint(vestingData.cliffNumerator, 16)
                .storeUint(vestingData.cliffDenominator, 16)
                .storeUint(vestingData.vestingPeriod, 32)
                .storeUint(vestingData.vestingNumerator, 16)
                .storeUint(vestingData.vestingDenominator, 16)
                .storeUint(vestingData.unlocksCount, 16)
                .endCell(),
        });
    }

    async sendClaimTokens(provider: ContractProvider, via: Sender, value: bigint, queryID: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(OPCODES.CLAIM_TOKENS, 32).storeUint(queryID, 64).endCell(),
        });
    }

    async getLockupData(provider: ContractProvider): Promise<LockupData> {
        const result = await provider.get('get_lockup_data', []);

        const init = result.stack.readBoolean();
        const adminAddress = result.stack.readAddress();
        const claimerAddress = result.stack.readAddress();
        const tokenBalance = result.stack.readBigNumber();
        const tokenClaimed = result.stack.readBigNumber();
        const lastClaimed = result.stack.readNumber();

        return {
            init,
            adminAddress,
            claimerAddress,
            tokenBalance,
            tokenClaimed,
            lastClaimed,
        };
    }

    async getVestingData(provider: ContractProvider): Promise<ExtendedVestingData> {
        const result = await provider.get('get_vesting_data', []);

        const jettonWalletAddress = result.stack.readAddress();
        const cliffEndDate = result.stack.readNumber();
        const cliffNumerator = result.stack.readNumber();
        const cliffDenominator = result.stack.readNumber();
        const vestingPeriod = result.stack.readNumber();
        const vestingNumerator = result.stack.readNumber();
        const vestingDenominator = result.stack.readNumber();
        const cliffUnlockAmount = result.stack.readBigNumber();
        const vestingUnlockAmount = result.stack.readBigNumber();
        const unlocksCount = result.stack.readNumber();

        return {
            jettonWalletAddress,
            cliffEndDate,
            cliffNumerator,
            cliffDenominator,
            vestingPeriod,
            vestingNumerator,
            vestingDenominator,
            cliffUnlockAmount,
            vestingUnlockAmount,
            unlocksCount,
        };
    }

    async getClaimableTokens(provider: ContractProvider): Promise<bigint> {
        const result = await provider.get('get_claimable_tokens', []);
        return result.stack.readBigNumber();
    }

    async getMinFee(provider: ContractProvider): Promise<bigint> {
        const result = await provider.get('get_min_fee', []);
        return result.stack.readBigNumber();
    }

    async getInitStorageFee(provider: ContractProvider): Promise<bigint> {
        const result = await provider.get('get_init_storage_fee', []);
        return result.stack.readBigNumber();
    }
}
