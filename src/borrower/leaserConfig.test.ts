import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWasmAdminWallet,
} from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';

//TO DO: error msgs - https://gitlab-nomo.credissimo.net/nomo/smart-contracts/-/issues/12
describe('Leaser contract tests - Config', () => {
  let wasmAdminWallet: NolusWallet;
  let wallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let configBefore: NolusContracts.LeaserConfig;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;

  let leaserConfigMsg: LeaserConfig;

  async function trySetConfig(expectedMsg: string): Promise<void> {
    const result = () =>
      leaserInstance.setLeaserConfig(
        wasmAdminWallet,
        leaserConfigMsg,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(`${expectedMsg}`);
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    const cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);

    wasmAdminWallet = await getWasmAdminWallet();
    wallet = await createWallet();

    configBefore = await leaserInstance.getLeaserConfig();
    leaserConfigMsg = JSON.parse(JSON.stringify(configBefore));

    // feed the wasm admin
    const userWithBalance = await getUser1Wallet();

    const adminBalanceAmount = '10000000';
    const adminBalance = {
      amount: adminBalanceAmount,
      denom: NATIVE_MINIMAL_DENOM,
    };
    await userWithBalance.transferAmount(
      wasmAdminWallet.address as string,
      [adminBalance],
      customFees.transfer,
    );
  });

  afterEach(async () => {
    leaserConfigMsg = JSON.parse(JSON.stringify(configBefore));

    const configAfter = await leaserInstance.getLeaserConfig();

    expect(configAfter).toStrictEqual(configBefore);
  });

  test('an unauthorized user tries to change the configuration - should produce an error', async () => {
    await sendInitExecuteFeeTokens(wasmAdminWallet, wallet.address as string);

    const result = () =>
      leaserInstance.setLeaserConfig(wallet, leaserConfigMsg, customFees.exec);

    await expect(result).rejects.toThrow(/^.*Unauthorized.*/);
  });

  test('the business tries to set initial liability % > healthy liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.init_percent =
      leaserConfigMsg.config.liability.healthy_percent + 1;

    await trySetConfig('Healthy % should be >= initial %');
  });

  test('the business tries to set initial liability % > max liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.init_percent =
      leaserConfigMsg.config.liability.max_percent + 1;

    await trySetConfig('Healthy % should be >= initial %');
  });

  test('the business tries to set healthy liability % > max liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.healthy_percent =
      leaserConfigMsg.config.liability.max_percent + 1;

    await trySetConfig('First liquidation % should be > healthy %');
  });

  test('the business tries to set first liq warn % <= healthy liability % - should produce an error', async () => {
    leaserConfigMsg.config.liability.first_liq_warn =
      leaserConfigMsg.config.liability.healthy_percent - 1;

    await trySetConfig('First liquidation % should be > healthy %');

    leaserConfigMsg.config.liability.first_liq_warn =
      leaserConfigMsg.config.liability.healthy_percent;

    await trySetConfig('First liquidation % should be > healthy %');
  });

  test('the business tries to set second liq warn % <= first liq warn % - should produce an error', async () => {
    leaserConfigMsg.config.liability.second_liq_warn =
      leaserConfigMsg.config.liability.first_liq_warn - 1;

    await trySetConfig('Second liquidation % should be > first liquidation %');

    leaserConfigMsg.config.liability.second_liq_warn =
      leaserConfigMsg.config.liability.first_liq_warn;

    await trySetConfig('Second liquidation % should be > first liquidation %');
  });

  test('the business tries to set third liq warn % <= second liq warn % - should produce an error', async () => {
    leaserConfigMsg.config.liability.third_liq_warn =
      leaserConfigMsg.config.liability.second_liq_warn - 1;

    await trySetConfig('Third liquidation % should be > second liquidation %');

    leaserConfigMsg.config.liability.third_liq_warn =
      leaserConfigMsg.config.liability.second_liq_warn;

    await trySetConfig('Third liquidation % should be > second liquidation %');
  });

  test('the business tries to set third liq warn % >= max % - should produce an error', async () => {
    leaserConfigMsg.config.liability.third_liq_warn =
      leaserConfigMsg.config.liability.max_percent + 1;

    await trySetConfig('Max % should be > third liquidation %');

    leaserConfigMsg.config.liability.third_liq_warn =
      leaserConfigMsg.config.liability.max_percent;

    await trySetConfig('Max % should be > third liquidation %');
  });

  test('the business tries to set grace period > interest period - should produce an error', async () => {
    leaserConfigMsg.config.repayment.grace_period =
      leaserConfigMsg.config.repayment.period + 1;

    await trySetConfig('Period length should be greater than grace period');
  });
});
