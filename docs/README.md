# Jetton Lockup Contract

Требуемая функциональность:

- Вестинг токенов
- Клейм токенов каждые n секунд
- Разлок токенов сразу после окончания cliff

## Technical Specification

### Storage

```tl-b
_ jetton_wallet:MsgAddressInt cliff_end_date:uint32 cliff_numerator:uint16 cliff_denominator:uint16
  vesting_period:uint32 vesting_numerator:uint16 vesting_denominator:uint16 cliff_unlock_amount:Coins
  vesting_unlock_amount:Coins unlocks_count:uint16 = VestingData; // 659 bits
_ admin_address:MsgAddressInt claimer_address:MsgAddressInt token_balance:Coins token_claimed:Coins
  last_claimed:uint32 vesting_data:^VestingData = VestingLockupStorage; // 814 bits
```

Поля, которые участвуют в подсчёте адреса:

- admin_address
- claimer_address

Остальные поля должны быть заполнены с адреса `admin_address` при деплое:

| Field | Description |
| --- | --- |
| jetton_wallet | Адрес кошелька, с которого будут списываться токены |
| cliff_end_date | Дата окончания периода cliff |
| cliff_numerator | Числитель периода cliff |
| cliff_denominator | Знаменатель периода cliff |
| vesting_period | Длительность каждого периода |
| vesting_numerator | Числитель периода |
| vesting_denominator | Знаменатель периода |
| cliff_unlock_amount | Количество токенов, которые будут разблокированы после окончания периода cliff |
| vesting_unlock_amount | Количество токенов, которые будут разблокированы каждый период |
| unlocks_count | Количество разблокировок |

`cliff_numerator` и `cliff_denominator` отвечают за то, какой процент токенов будет разблокирован после окончания периода `cliff_end_date`. 

`vesting_numerator` и `vesting_denominator` отвечают за то, какой процент токенов будет разблокирован каждый период `vesting_period`.

### Формула разблокировки токенов

- Подсчёт того, сколько каждый раз должно быть разблокировано токенов. Данные значения подсчитываются один раз при инициализации контракта и не меняются в дальнейшем:
  - `cliff_unlock_amount` = muldiv(token_balance, cliff_numerator, cliff_denominator)
  - `vesting_unlock_amount` = muldiv(token_balance, vesting_numerator, vesting_denominator)
- Если `now()` < `cliff_end_date`, то
  - `claimable_tokens` = 0
- Иначе:
- Подсчёт того, сколько времени прошло с момента начала вестинга:
  - `passed_periods` = (now() - cliff_end_date) / vesting_period
- Подсчёт того, сколько ещё осталось разблокировок (но это поле не обновляется в хранилище, а подсчитывается каждый раз при клейминге):
  - `unlocks_remaining` = max(0, unlocks_count - passed_periods)
- Подсчёт того, сколько токенов разблокировано на данный момент:
  - Если `unlocks_remaining` > 0, то
    - `unlocked_tokens` = `cliff_unlock_amount` + `vesting_unlock_amount` * `passed_periods`
  - Иначе
    - `claimable_tokens` = `token_balance`
- Подсчёт того, сколько токенов необходимо заклеймить (актуально, если `unlocks_remaining` > 0):
  - `claimable_tokens` = `unlocked_tokens` - `token_claimed`
  - `claimable_tokens` = min(`claimable_tokens`, `token_balance`)

После этого мы получаем количество токенов, которое можно заклеймить.

### Клейминг токенов

Для того, чтобы заклеймить, пользователь должен отправить следующее сообщение:

```tl-b
claim_tokens#3651a88c query_id:uint64 = InternalMsgBody;
```

Для успешного клейма должны быть выполнены следующие условия:

- `sender_address` должен быть равен `claimer_address`
- прислано правильное количество TON для обработки сообщения
- `claimable_tokens` > 0

После этого отправляется сообщение на адрес `jetton_wallet` с количеством токенов = `claimable_tokens`:

- `forward_amount` будет всегда равен 1 nTON (nanoton)
- `response_destination` будет равен `claimer_address`

Происходят следующие изменения в хранилище:

- `token_claimed` += `claimable_tokens`
- `last_claimed` = now()
- `token_balance` -= `claimable_tokens`

### Неудачный клейминг

Предполагается, что изначально на контракте будет правильно количество токенов, равное `token_balance`. Однако если вдруг по каким-то причинам баланса не хватает или произошла ошибка на стороне Jetton Wallet, то контракт получит bounce.

В таком случае будут следующие изменения:

- `token_balance` += `transfer_amount`
- `token_claimed` -= `transfer_amount`

Значение `transfer_amount` будет взято из bounce сообщения. Таким образом потеря токенов будет невозможно при условии стандартной реализации Jetton Wallet.

### Резервная функциональность ???

Добавить возможность для `admin_address` отправлять любое сообщение с lockup контракта (использовать как кошелёк) при условии, что token_balance = 0 (все токены заклеймены и вестинг закончен).