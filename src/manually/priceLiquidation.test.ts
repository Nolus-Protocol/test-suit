import { TextDecoder } from 'node:util';
import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import NODE_ENDPOINT, {
  createWallet,
  getFeederWallet,
  getUser1Wallet,
  txSearchByEvents,
} from '../util/clients';
import { customFees, sleep, undefinedHandler, defaultTip } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { currencyTicker_To_IBC } from '../util/smart-contracts/calculations';
import {
  getLeaseAddressFromOpenLeaseResponse,
  findWasmEventPositions,
} from '../util/smart-contracts/getters';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';
import {
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';

const textDecoder = new TextDecoder();

// These tests require the network to be specifically configured
// That`s why, they only work locally and in isolation, and only if this requirement is met!
// Suitable values are :
// - for the Leaser config - {...,"lease_interest_rate_margin":30,"liability":{"initial":650,"healthy":700,"first_liq_warn":720,"second_liq_warn":750,"third_liq_warn":780,"max":800,"recalc_time":7200000000000},......,"lease_interest_payment":{"due_period":5184000000000000,"grace_period":864000000000000}}
// - for the Oracle  config - {"config":{....,"price_config":{"min_feeders":500,"sample_period_secs":260,"samples_number":1,"discount_factor":750}},....}
// - working dispatcher bot
// - !!! non-working feeder

// Before running -> update:
// - "alarmDispatcherPeriod" = configured "poll_period_seconds" + 5 /take from the alarms-dispatcher bot config/
// - check and fill "validPriceLCtoLPN" (LC = "leaseCurrency")
// - "periodSecs" = configured "sample_period_secs" /take from the Oracle smart contract config/
describe('Lease - Price Liquidation tests', () => {
  let cosm: CosmWasmClient;
  let borrowerWallet: NolusWallet;
  let userWithBalanceWallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let oracleInstance: NolusContracts.Oracle;
  let lppInstance: NolusContracts.Lpp;
  let feederWallet: NolusWallet;
  let leaserConfig: NolusContracts.LeaserConfig;
  let lpnCurrency: string;
  let downpaymentCurrency: string;
  let downpaymentCurrencyToIBC: string;
  let leaseAddress: string;
  let maxLiability: number;
  let w1Liability: number;
  let w2Liability: number;
  let w3Liability: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

  const alarmDispatcherPeriod = 15; // DispatcherBot:poll_period_seconds + 5
  const periodSecs = 265; // Oracle:sample_period_secs + 5sec
  const leaseCurrency = 'OSMO';
  const validPriceLCtoLPN = 0.25552;
  const downpayment = '1000000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    borrowerWallet = await createWallet();
    userWithBalanceWallet = await getUser1Wallet();
    feederWallet = await getFeederWallet();

    leaserConfig = await leaserInstance.getLeaserConfig();
    maxLiability = leaserConfig.config.liability.max;
    w1Liability = leaserConfig.config.liability.first_liq_warn;
    w2Liability = leaserConfig.config.liability.second_liq_warn;
    w3Liability = leaserConfig.config.liability.third_liq_warn;

    const lppConfig = await lppInstance.getLppConfig();
    lpnCurrency = lppConfig.lpn_ticker;
    downpaymentCurrency = lpnCurrency;
    downpaymentCurrencyToIBC = currencyTicker_To_IBC(downpaymentCurrency);

    await pushPrice(validPriceLCtoLPN);

    await provideEnoughLiquidity(
      leaserInstance,
      lppInstance,
      downpayment,
      downpaymentCurrency,
      leaseCurrency,
    );
  });

  async function pushPrice(price: number) {
    let amount = 2;

    const length = price.toString().split('.')[1].length;
    const amountQuote = Math.trunc(price * Math.pow(10, length) * amount);
    amount = amount * Math.pow(10, length);

    const priceObj = {
      prices: [
        {
          amount: { amount: amount.toString(), ticker: leaseCurrency },
          amount_quote: {
            amount: amountQuote.toString(),
            ticker: lpnCurrency,
          },
        },
      ],
    };

    await userWithBalanceWallet.transferAmount(
      feederWallet.address as string,
      customFees.exec.amount,
      customFees.transfer,
    );

    await oracleInstance.feedPrices(feederWallet, priceObj, 1.3);

    const priceAfterConfig = await oracleInstance.getPriceFor(leaseCurrency);

    expect(
      +priceAfterConfig.amount_quote.amount / +priceAfterConfig.amount.amount,
    ).toBe(price);
  }

  async function checkForLiquidationWarning(
    wPrice: number,
    warningLevel: number,
  ) {
    await sleep(periodSecs);
    await pushPrice(wPrice);

    await sleep(alarmDispatcherPeriod);

    const txsCount = (
      await txSearchByEvents(
        `wasm-ls-liquidation-warning._contract_address='${leaseAddress}'`,
        undefined,
        undefined,
      )
    ).totalCount;

    const repayTxResponse = (
      await txSearchByEvents(
        `wasm-ls-liquidation-warning._contract_address='${leaseAddress}'`,
        txsCount,
        1,
      )
    ).txs;

    const wasmEventIndex = findWasmEventPositions(
      repayTxResponse[0].result,
      'wasm-ls-liquidation-warning',
    );

    expect(
      +textDecoder.decode(
        repayTxResponse[0].result.events[
          wasmEventIndex[wasmEventIndex.length - 1]
        ].attributes[4].value,
      ),
    ).toBe(warningLevel);
  }

  test('liquidation due to a drop in price - should work as expected', async () => {
    await userWithBalanceWallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: downpaymentCurrencyToIBC, amount: downpayment }, defaultTip],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    const response = await leaserInstance.openLease(
      borrowerWallet,
      leaseCurrency,
      customFees.exec,
      undefined,
      [
        {
          denom: downpaymentCurrencyToIBC,
          amount: downpayment,
        },
        defaultTip,
      ],
    );

    leaseAddress = getLeaseAddressFromOpenLeaseResponse(response);
    console.log('Lease address: ', leaseAddress);

    const leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);
    expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    const stateBeforeLiquidation = await leaseInstance.getLeaseStatus();
    if (!stateBeforeLiquidation.opened) {
      undefinedHandler();
      return;
    }

    const leaseAmount = +stateBeforeLiquidation.opened?.amount.amount;
    const leaseDue =
      +stateBeforeLiquidation.opened?.principal_due.amount +
      +stateBeforeLiquidation.opened?.current_interest_due.amount +
      +stateBeforeLiquidation.opened?.current_margin_due.amount +
      +stateBeforeLiquidation.opened?.previous_interest_due.amount +
      +stateBeforeLiquidation.opened?.previous_margin_due.amount;

    const w1Price = (leaseDue * 1000) / (leaseAmount * w1Liability);
    const w2Price = (leaseDue * 1000) / (leaseAmount * w2Liability);
    const w3Price = (leaseDue * 1000) / (leaseAmount * w3Liability);

    const liquidationPrice = (leaseDue * 1000) / (leaseAmount * maxLiability);

    // w1
    await checkForLiquidationWarning(w1Price, 1);

    // w2
    await checkForLiquidationWarning(w2Price, 2);

    //w3
    await checkForLiquidationWarning(w3Price, 3);

    //max
    await sleep(periodSecs);
    await pushPrice(liquidationPrice);

    await sleep(alarmDispatcherPeriod);
    await waitLeaseInProgressToBeNull(leaseInstance);

    const stateAfterLiquidation = await leaseInstance.getLeaseStatus();

    if (stateAfterLiquidation.opened) {
      expect(+stateAfterLiquidation.opened.amount.amount).toBeLessThan(
        +stateBeforeLiquidation.opened.amount.amount,
      );
    } else {
      expect(stateAfterLiquidation.liquidated).toBeDefined();
    }
  });
});
