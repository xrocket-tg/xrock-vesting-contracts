import {
    Blockchain,
    BlockchainSnapshot,
    BlockchainTransaction,
    createShardAccount,
    internal,
    SandboxContract,
    TreasuryContract,
} from '@ton/sandbox';
import {
    Address,
    beginCell,
    Cell,
    storeStateInit,
    toNano,
    TransactionComputeVm,
    TransactionDescriptionGeneric,
} from '@ton/core';
import { ExtendedVestingData, JettonLockup, JettonLockupConfig, VestingData } from '../wrappers/JettonLockup';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { randomAddress } from '@ton/test-utils';
import { ERRORS, JETTON_WALLET_CODE, OPCODES } from '../wrappers/Config';
import { printTransactionFees } from './utils/printTransactionFees';
import { collectCellStats } from './utils/gas';

describe('JettonLockup', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('JettonLockup');
    });

    let blockchain: Blockchain;
    let jettonLockup: SandboxContract<JettonLockup>;

    let claimer: SandboxContract<TreasuryContract>;
    let admin: SandboxContract<TreasuryContract>;

    const jettonMasterAddress = randomAddress();

    const creationNow = Math.floor(Date.now() / 1000);
    const tokenBalanceConfig = 25000n;
    let afterDeploy: BlockchainSnapshot;
    let vestingDataConfig: VestingData = {
        jettonWalletAddress: randomAddress(),
        cliffEndDate: creationNow + 60,
        cliffNumerator: 12,
        cliffDenominator: 100,
        vestingPeriod: 30,
        vestingNumerator: 15,
        vestingDenominator: 100,
        unlocksCount: 0,
    };
    let extendedVestingDataConfig: ExtendedVestingData;
    let lockupJettonWallet: Address;
    let claimerJettonWallet: Address;
    let addresses: { [key: string]: string } = {};

    const userJettonWalletInit = (address: Address): Cell => {
        return beginCell()
            .store(
                storeStateInit({
                    code: JETTON_WALLET_CODE,
                    data: beginCell()
                        .storeCoins(0)
                        .storeAddress(address)
                        .storeAddress(jettonMasterAddress)
                        .storeRef(JETTON_WALLET_CODE)
                        .endCell(),
                }),
            )
            .endCell();
    };
    const userJettonWalletAddress = (address: Address): Address => {
        return new Address(0, userJettonWalletInit(address).hash());
    };
    let testClaim: (amount: bigint, queryID: bigint, shouldClaim: bigint) => Promise<BlockchainTransaction[]>;

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = creationNow;
        admin = await blockchain.treasury('admin');
        claimer = await blockchain.treasury('claimer');

        jettonLockup = blockchain.openContract(
            JettonLockup.createFromConfig(
                {
                    adminAddress: admin.address,
                    claimerAddress: claimer.address,
                },
                code,
            ),
        );

        lockupJettonWallet = userJettonWalletAddress(jettonLockup.address);

        await blockchain.setShardAccount(
            lockupJettonWallet,
            createShardAccount({
                address: lockupJettonWallet,
                code: JETTON_WALLET_CODE,
                data: beginCell()
                    .storeCoins(tokenBalanceConfig)
                    .storeAddress(jettonLockup.address)
                    .storeAddress(jettonMasterAddress)
                    .storeRef(JETTON_WALLET_CODE)
                    .endCell(),
                balance: toNano(1),
            }),
        );

        console.log(`Jetton wallet state init: ${collectCellStats(userJettonWalletInit(jettonLockup.address), [])}`);

        vestingDataConfig.jettonWalletAddress = lockupJettonWallet;
        vestingDataConfig.unlocksCount = Math.ceil(
            (1 - vestingDataConfig.cliffNumerator / vestingDataConfig.cliffDenominator) /
                (vestingDataConfig.vestingNumerator / vestingDataConfig.vestingDenominator),
        );

        extendedVestingDataConfig = {
            ...vestingDataConfig,
            cliffUnlockAmount:
                (tokenBalanceConfig * BigInt(vestingDataConfig.cliffNumerator)) /
                BigInt(vestingDataConfig.cliffDenominator),
            vestingUnlockAmount:
                (tokenBalanceConfig * BigInt(vestingDataConfig.vestingNumerator)) /
                BigInt(vestingDataConfig.vestingDenominator),
        };

        const deployResult = await jettonLockup.sendDeploy(
            admin.getSender(),
            toNano('1'),
            tokenBalanceConfig,
            vestingDataConfig,
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: admin.address,
            to: jettonLockup.address,
            deploy: true,
            success: true,
        });

        claimerJettonWallet = userJettonWalletAddress(claimer.address);

        addresses[admin.address.toString()] = 'admin';
        addresses[claimer.address.toString()] = 'claimer';
        addresses[lockupJettonWallet.toString()] = 'lockup jetton wallet';
        addresses[claimerJettonWallet.toString()] = 'claimer jetton wallet';
        addresses[jettonLockup.address.toString()] = 'jetton lockup';
        console.log(addresses);
        printTransactionFees(deployResult.transactions, 'Deploy', addresses);

        testClaim = async (amount: bigint, queryID: bigint, shouldClaim: bigint) => {
            const claimableTokens = await jettonLockup.getClaimableTokens();
            expect(claimableTokens).toStrictEqual(shouldClaim);
            const initialLockupData = await jettonLockup.getLockupData();
            const result = await jettonLockup.sendClaimTokens(claimer.getSender(), amount, queryID);

            expect(result.transactions).toHaveTransaction({
                from: claimer.address,
                to: jettonLockup.address,
                success: true,
            });
            expect(result.transactions).toHaveTransaction({
                from: jettonLockup.address,
                to: lockupJettonWallet,
                success: true,
                body: beginCell()
                    .storeUint(OPCODES.JETTON_TRANSFER, 32)
                    .storeUint(queryID, 64)
                    .storeCoins(shouldClaim)
                    .storeAddress(claimer.address)
                    .storeAddress(claimer.address)
                    .storeBit(false)
                    .storeCoins(1n)
                    .storeBit(false)
                    .endCell(),
            });
            expect(result.transactions).toHaveTransaction({
                from: lockupJettonWallet,
                to: claimerJettonWallet,
                success: true,
                body: beginCell()
                    .storeUint(OPCODES.JETTON_INTERNAL_TRANSFER, 32)
                    .storeUint(queryID, 64)
                    .storeCoins(shouldClaim)
                    .storeAddress(jettonLockup.address)
                    .storeAddress(claimer.address)
                    .storeCoins(1n)
                    .storeBit(false)
                    .endCell(),
            });
            expect(result.transactions).toHaveTransaction({
                from: claimerJettonWallet,
                to: claimer.address,
                success: false, // because in_value = 1 nTON
                value: 1n,
                body: beginCell()
                    .storeUint(OPCODES.JETTON_TRANSFER_NOTIFICATION, 32)
                    .storeUint(queryID, 64)
                    .storeCoins(shouldClaim)
                    .storeAddress(jettonLockup.address)
                    .storeBit(false)
                    .endCell(),
            });
            // The presence of a transaction that returns excesses does not need to be tested,
            // since it will not be if there are no excesses

            const lockupData = await jettonLockup.getLockupData();
            expect(lockupData.tokenClaimed).toStrictEqual(initialLockupData.tokenClaimed + shouldClaim);
            expect(lockupData.lastClaimed).toStrictEqual(blockchain.now);
            expect(lockupData.tokenBalance).toStrictEqual(initialLockupData.tokenBalance - shouldClaim);

            return result.transactions;
        };
    });

    it('should deploy', async () => {
        const lockupData = await jettonLockup.getLockupData();
        expect(lockupData.init).toBeTruthy();
        expect(lockupData.adminAddress.toString()).toStrictEqual(admin.address.toString());
        expect(lockupData.claimerAddress.toString()).toStrictEqual(claimer.address.toString());
        expect(lockupData.tokenBalance).toStrictEqual(tokenBalanceConfig);
        expect(lockupData.tokenClaimed).toStrictEqual(0n);
        expect(lockupData.lastClaimed).toStrictEqual(0);

        const vestingData = await jettonLockup.getVestingData();
        expect(vestingData.jettonWalletAddress.toString()).toStrictEqual(
            extendedVestingDataConfig.jettonWalletAddress.toString(),
        );
        expect(vestingData.cliffEndDate).toStrictEqual(extendedVestingDataConfig.cliffEndDate);
        expect(vestingData.cliffNumerator).toStrictEqual(extendedVestingDataConfig.cliffNumerator);
        expect(vestingData.cliffDenominator).toStrictEqual(extendedVestingDataConfig.cliffDenominator);
        expect(vestingData.vestingPeriod).toStrictEqual(extendedVestingDataConfig.vestingPeriod);
        expect(vestingData.vestingNumerator).toStrictEqual(extendedVestingDataConfig.vestingNumerator);
        expect(vestingData.vestingDenominator).toStrictEqual(extendedVestingDataConfig.vestingDenominator);
        expect(vestingData.cliffUnlockAmount).toStrictEqual(extendedVestingDataConfig.cliffUnlockAmount);
        expect(vestingData.vestingUnlockAmount).toStrictEqual(extendedVestingDataConfig.vestingUnlockAmount);
        expect(vestingData.unlocksCount).toStrictEqual(extendedVestingDataConfig.unlocksCount);

        const initStorageFee = await jettonLockup.getInitStorageFee();
        expect((await blockchain.getContract(jettonLockup.address)).balance).toStrictEqual(initStorageFee);
        console.log('Init storage fee: ', initStorageFee);
        afterDeploy = blockchain.snapshot();
    });

    it('should accept claim only from owner', async () => {
        const result = await jettonLockup.sendClaimTokens(admin.getSender(), toNano('1'), 0n);
        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: jettonLockup.address,
            success: false,
            exitCode: ERRORS.UNAUTHORIZED,
        });
    });

    it('nothing to claim', async () => {
        const result = await jettonLockup.sendClaimTokens(claimer.getSender(), toNano('1'), 0n);
        expect(result.transactions).toHaveTransaction({
            from: claimer.address,
            to: jettonLockup.address,
            success: false,
            exitCode: ERRORS.NOTHING_TO_CLAIM,
        });
    });

    it('not enough funds to process claim', async () => {
        const minFee = await jettonLockup.getMinFee();
        let result = await jettonLockup.sendClaimTokens(claimer.getSender(), minFee - 1n, 0n);
        expect(result.transactions).toHaveTransaction({
            from: claimer.address,
            to: jettonLockup.address,
            success: false,
            exitCode: ERRORS.NOT_ENOUGH_TON,
        });

        result = await jettonLockup.sendClaimTokens(claimer.getSender(), minFee, 0n);
        expect(result.transactions).toHaveTransaction({
            from: claimer.address,
            to: jettonLockup.address,
            success: false,
            exitCode: ERRORS.NOTHING_TO_CLAIM,
        });
    });

    it('after 1 year', async () => {
        blockchain.now! += 365 * 24 * 60 * 60;
        const minFee = await jettonLockup.getMinFee();
        const tx = await testClaim(minFee, 3n, tokenBalanceConfig);
        printTransactionFees(tx, 'After 1 year', addresses);
        await blockchain.loadFrom(afterDeploy);
    });

    it('cliff unlock', async () => {
        blockchain.now! += 59;
        let result = await jettonLockup.sendClaimTokens(claimer.getSender(), toNano('1'), 0n);
        expect(result.transactions).toHaveTransaction({
            from: claimer.address,
            to: jettonLockup.address,
            success: false,
            exitCode: ERRORS.NOTHING_TO_CLAIM,
        });

        blockchain.now! += 1;
        const tx = await testClaim(toNano('1'), 0n, extendedVestingDataConfig.cliffUnlockAmount);
        printTransactionFees(tx, 'Cliff unlock', addresses);

        result = await jettonLockup.sendClaimTokens(claimer.getSender(), toNano('1'), 0n);
        expect(result.transactions).toHaveTransaction({
            from: claimer.address,
            to: jettonLockup.address,
            success: false,
            exitCode: ERRORS.NOTHING_TO_CLAIM,
        });
    });

    it('1st vesting unlock', async () => {
        blockchain.now! += 29;
        let result = await jettonLockup.sendClaimTokens(claimer.getSender(), toNano('1'), 0n);
        expect(result.transactions).toHaveTransaction({
            from: claimer.address,
            to: jettonLockup.address,
            success: false,
            exitCode: ERRORS.NOTHING_TO_CLAIM,
        });

        blockchain.now! += 1;
        const tx = await testClaim(toNano('1'), 1n, extendedVestingDataConfig.vestingUnlockAmount);
        printTransactionFees(tx, '1st vesting unlock', addresses);
        const txDescription = tx[1].description as TransactionDescriptionGeneric;
        const computePhase = txDescription.computePhase as TransactionComputeVm;
        console.log('Claim compute fee: ', computePhase.gasUsed);
    });

    it('remaining vesting unlocks (except last)', async () => {
        for (let i = 2; i < extendedVestingDataConfig.unlocksCount; i++) {
            blockchain.now! += extendedVestingDataConfig.vestingPeriod - 1;
            let result = await jettonLockup.sendClaimTokens(claimer.getSender(), toNano('1'), 0n);
            expect(result.transactions).toHaveTransaction({
                from: claimer.address,
                to: jettonLockup.address,
                success: false,
                exitCode: ERRORS.NOTHING_TO_CLAIM,
            });

            blockchain.now! += 1;
            const tx = await testClaim(toNano('1'), BigInt(i), extendedVestingDataConfig.vestingUnlockAmount);
            printTransactionFees(tx, `Vesting unlock ${i}`, addresses);
        }
    });

    it('bounce', async () => {
        const initialLockupData = await jettonLockup.getLockupData();
        expect(initialLockupData.tokenClaimed).toBeLessThan(tokenBalanceConfig);
        expect(initialLockupData.tokenBalance).toBeGreaterThan(0n);

        const before = blockchain.snapshot();
        await blockchain.setShardAccount(
            lockupJettonWallet,
            createShardAccount({
                address: lockupJettonWallet,
                code: JETTON_WALLET_CODE,
                data: beginCell()
                    .storeCoins(0)
                    .storeAddress(jettonLockup.address)
                    .storeAddress(jettonMasterAddress)
                    .storeRef(JETTON_WALLET_CODE)
                    .endCell(),
                balance: 0n,
            }),
        );
        blockchain.now! += extendedVestingDataConfig.vestingPeriod;
        const message = internal({
            from: claimer.address,
            to: jettonLockup.address,
            value: toNano('1'),
            body: beginCell().storeUint(OPCODES.CLAIM_TOKENS, 32).storeUint(0, 64).endCell(),
        });
        let result = await blockchain.sendMessageIter(message);
        let tx = await result.next();
        expect(tx.value as BlockchainTransaction).toHaveTransaction({
            from: claimer.address,
            to: jettonLockup.address,
            success: true,
        });
        tx = await result.next();
        let lockupData = await jettonLockup.getLockupData();
        expect(lockupData.tokenClaimed).toStrictEqual(tokenBalanceConfig);
        expect(lockupData.lastClaimed).toStrictEqual(blockchain.now);
        expect(lockupData.tokenBalance).toStrictEqual(0n);

        expect(tx.value as BlockchainTransaction).toHaveTransaction({
            from: jettonLockup.address,
            to: lockupJettonWallet,
            success: false,
        });

        tx = await result.next();
        expect(tx.value as BlockchainTransaction).toHaveTransaction({
            from: lockupJettonWallet,
            to: jettonLockup.address,
            success: true,
            inMessageBounced: true,
        });
        lockupData = await jettonLockup.getLockupData();
        expect(lockupData.tokenClaimed).toStrictEqual(initialLockupData.tokenClaimed);
        expect(lockupData.tokenBalance).toStrictEqual(initialLockupData.tokenBalance);

        tx = await result.next();
        expect(tx.value).toBeUndefined();
        expect(tx.done).toBeTruthy();

        await blockchain.loadFrom(before);
    });

    it('last vesting unlock', async () => {
        blockchain.now! += extendedVestingDataConfig.vestingPeriod - 1;
        let result = await jettonLockup.sendClaimTokens(claimer.getSender(), toNano('1'), 0n);
        expect(result.transactions).toHaveTransaction({
            from: claimer.address,
            to: jettonLockup.address,
            success: false,
            exitCode: ERRORS.NOTHING_TO_CLAIM,
        });

        let lockupData = await jettonLockup.getLockupData();
        blockchain.now! += 1;
        const tx = await testClaim(
            toNano('1'),
            BigInt(extendedVestingDataConfig.unlocksCount),
            lockupData.tokenBalance,
        );

        lockupData = await jettonLockup.getLockupData();
        expect(lockupData.tokenClaimed).toStrictEqual(tokenBalanceConfig);
        expect(lockupData.lastClaimed).toStrictEqual(blockchain.now);
        expect(lockupData.tokenBalance).toStrictEqual(0n);

        printTransactionFees(tx, `Last vesting unlock`, addresses);
    });

    it('max states', async () => {
        const initialState = blockchain.snapshot();
        const vestingData = beginCell()
            .storeAddress(randomAddress())
            .storeUint(2n ** 32n - 1n, 32)
            .storeUint(2n ** 16n - 1n, 16)
            .storeUint(2n ** 16n - 1n, 16)
            .storeUint(2n ** 32n - 1n, 32)
            .storeUint(2n ** 16n - 1n, 16)
            .storeUint(2n ** 16n - 1n, 16)
            .storeCoins(2n ** 120n - 1n)
            .storeCoins(2n ** 120n - 1n)
            .storeUint(2n ** 16n - 1n, 16)
            .endCell();
        const lockupStorage = beginCell()
            .storeAddress(randomAddress())
            .storeAddress(randomAddress())
            .storeCoins(2n ** 120n - 1n)
            .storeCoins(2n ** 120n - 1n)
            .storeUint(2n ** 32n - 1n, 32)
            .storeRef(vestingData)
            .endCell();
        await blockchain.setShardAccount(
            jettonLockup.address,
            createShardAccount({
                address: jettonLockup.address,
                code: code,
                data: lockupStorage,
                balance: 5_000_000_000n,
            }),
        );

        await blockchain.setShardAccount(
            lockupJettonWallet,
            createShardAccount({
                address: lockupJettonWallet,
                code: JETTON_WALLET_CODE,
                data: beginCell()
                    .storeCoins(2n ** 120n - 1n)
                    .storeAddress(jettonLockup.address)
                    .storeAddress(jettonMasterAddress)
                    .storeRef(JETTON_WALLET_CODE)
                    .endCell(),
                balance: 5_000_000_000n,
            }),
        );
        // any message is necessary for the contact to appear
        // in the blockchain and data about it can be obtained
        await blockchain.sendMessage(
            internal({
                from: randomAddress(),
                to: jettonLockup.address,
                value: toNano('0.05'),
            }),
        );
        await blockchain.sendMessage(
            internal({
                from: randomAddress(),
                to: lockupJettonWallet,
                value: toNano('0.05'),
            }),
        );
        const lockupState = (await blockchain.getContract(jettonLockup.address)).account;
        console.log('Jetton lockup max state: ', lockupState.account!.storageStats);
        const walletState = (await blockchain.getContract(lockupJettonWallet)).account;
        console.log('Jetton wallet max state: ', walletState.account!.storageStats);
        await blockchain.loadFrom(initialState);
    });
});
