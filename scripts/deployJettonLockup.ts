import { toNano } from '@ton/core';
import { JettonLockup } from '../wrappers/JettonLockup';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const jettonLockup = provider.open(JettonLockup.createFromConfig({}, await compile('JettonLockup')));

    await jettonLockup.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(jettonLockup.address);

    // run methods on `jettonLockup`
}
