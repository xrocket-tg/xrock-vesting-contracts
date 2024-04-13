# xrock-vesting audit report
* **Author: @akifoq**
* **Date: 11-13 April 2024**
* **Method: manual review**
* **Commit hash: ba38ba2**

## Project overview
The contract allows to create a vesting of a specified jetton token for a user wallet. The jetton balance is gradually unlocked and the user is able to claim the unlocked tokens.

Namely, the contract allows to claim exactly `cliff_unlock_amount` jettons after the `cliff_end_date` (unix timestamp) moment and then `vesting_unlock_amount` for each `vesting_period` seconds passed after this until `unlocks_count` periods have passed. After that moment it allows to claim all of the remaining tokens. The user isn't required to claim the tokens as soon as they are unlocked; if one or several unlocks were skipped, it's possible to claim all of the unlocked jettons at once.

The claimed tokens are transferred to the jetton wallet associated with the specified user wallet. Essentially this means transferring the tokens to the user.

Once the vesting contract is deployed and initialized, the `token_balance` field is the overall number of tokens allocated for the vesting (it decreases on each claim). It's important to check that the jetton wallet associated with the contract actually has at least `token_balance` jettons on its balance. 

Maximal vesting duration is supposed to be at most 10 years.

The user wallet mush reside in the basechain (it is so for practically all popular wallet applications).

## Scope of the audit
Only the security and correctness of the smart contract were verified. The offchain interface (dapp) used to interact with it requires additional trust from the user.

The vesting contract is designed to work with the standart (reference) jetton implementation only. Correctness for other jetton implementations is not guaranteed (although manly the fee constants are to be changed in such cases).

## Found issues

### Medium severity
* **Forgotten `load_data()/save_data()` in the bounced messages handler (resolved)**\
  It's important to actually update `token_claimed` and `token_balance` in the case a claim failed. Such fails are unlikely but possible and could lead to a token loss without the handler.
* **Possible claim fails due to hardcoded constants in the reference jetton implementation (resolved)**\
  Before sending the request to transfer the claimed tokens to the jetton wallet, the contract checks that the message value is enough to pay for all the fees. However, in the case the blockchain fees are decreased it could lead to the request being denied by the standart jetton wallet because it uses hardcoded values for the fees. Together with the previous issue it could lead to the token loss.
* **Possible freezing of the contract or one of the jetton wallets (resolved)**\
  The vesting contract or its jetton wallet freezing doesn't lead to a loss. However, a loss could happen if the user's jetton wallet is frozen. Unfortunately, it's an inherent problem of the jetton standart. So it's important to transfer a small reserve amount (0.2 tons is enough for at least 20 years) for storage fees to the user's jetton wallet during the deployment stage. It's desided not to put this functionality to the vesting contract to avoid overcomplication.

### Minor severity
* **Lack of handling of the `vesting_period = 0` case (resolved)**\
  If `vesting_period = 0`, the contract doesn't allow to claim any tokens. Now it forbids the deployment with such value.

### Informational and optimizations
* **Missing inline_ref modifiers (resolved)**
* **Longer error codes are more expensive (resolved)**
* **It's better to do `.end_parse()` during data parsing (resolved)**
* **`claimer_address` is supposed not to have the Anycast field**\
  Otherwise the `TRANSFER_PAYLOAD_MAX_BITS` should be higher. However it's not intended to start a vesting for such a wallet.

## Summary
After resolving the issues the contract is safe. However, it's important to 
* Check the vesting parameters after the deployment
* Check that the vesting's jetton wallet has enough jettons to be claimed
* Transfer enough funds (0.2 tons) to the user's jetton wallet so it doesn't freeze until the vesting is over