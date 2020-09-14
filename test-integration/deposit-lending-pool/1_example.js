// Util classes
const BigNumber = require("bignumber.js");
const { teller, tokens } = require("../../scripts/utils/contracts");
const { lendingPool } = require('../../test/utils/events');
const { toDecimals } = require('../../test/utils/consts');
const assert = require("assert");

module.exports = async ({processArgs, accounts, getContracts, timer, swapper}) => {
  console.log('Integration Test Example.');
  const senderTxConfig = await accounts.getTxConfigAt(1);
  const tokenName = processArgs.getValue('testTokenName');
  const token = await getContracts.getDeployed(tokens.get(tokenName));
  const ttoken = await getContracts.getDeployed(teller.ttoken(tokenName));
  const amountWei = toDecimals(100, 18);
  await swapper.swapForExact([ swapper.wethAddress, token.address ], amountWei, senderTxConfig)
  // await token.mint(senderTxConfig.from, amountWei, senderTxConfig);

  const lendingPoolTToken = await getContracts.getDeployed(teller.eth().lendingPool(tokenName));
  const lendingToken = await lendingPoolTToken.lendingToken();
  assert(lendingToken === token.address, "Lending token and token are not equal.");

  const initialTtokenSenderBalance = await ttoken.balanceOf(senderTxConfig.from);

  console.log(`Depositing ${tokenName} into the lending pool...`);
  await token.approve(
    lendingPoolTToken.address,
    amountWei.toString(),
    senderTxConfig
  );
  const depositResult = await lendingPoolTToken.deposit(amountWei.toString(), senderTxConfig);

  lendingPool
    .tokenDeposited(depositResult)
    .emitted(senderTxConfig.from, amountWei);
  const finalTdaiSenderBalance = await ttoken.balanceOf(senderTxConfig.from);
  assert.equal(
    BigNumber(finalTdaiSenderBalance.toString()).minus(BigNumber(initialTtokenSenderBalance.toString())),
    amountWei.toString()
  );
};
