// Util classes
const BigNumber = require('bignumber.js');
const { teller, tokens, chainlink } = require("../../scripts/utils/contracts");
const { loans, lendingPool } = require('../../test/utils/events');
const { toDecimals, toUnits, NULL_ADDRESS, ONE_DAY, minutesToSeconds, daysToSeconds, NON_EXISTENT, toBytes32 } = require('../../test/utils/consts');
const loanStatuses = require('../../test/utils/loanStatus');
const { createMultipleSignedLoanTermsResponses, createLoanTermsRequest } = require('../../test/utils/loan-terms-helper');
const assert = require("assert");
const platformSettingsNames = require('../../test/utils/platformSettingsNames');

module.exports = async ({processArgs, accounts, getContracts, timer, web3, nonces, chainId, swapper}) => {
  console.log('Repay Loan in 4 Payments');
  const tokenName = processArgs.getValue('testTokenName');
  const collateralTokenName = 'LINK';
  const settingsInstance = await getContracts.getDeployed(teller.settings());
  const token = await getContracts.getDeployed(tokens.get(tokenName));
  const collateralToken = await getContracts.getDeployed(tokens.get(collateralTokenName));
  const lendingPoolInstance = await getContracts.getDeployed(teller.link().lendingPool(tokenName));
  const loansInstance = await getContracts.getDeployed(teller.link().loans(tokenName));
  const chainlinkOracle = await getContracts.getDeployed(chainlink.custom(collateralTokenName, tokenName));
  const loanTermConsensusInstance = await getContracts.getDeployed(teller.link().loanTermsConsensus(tokenName));

  const currentTimestamp = parseInt(await timer.getCurrentTimestamp());
  console.log(`Current timestamp: ${currentTimestamp} segs`);

  const borrower = await accounts.getAt(1);
  const recipient = NULL_ADDRESS;
  const collateralTokenDecimals = parseInt(await collateralToken.decimals());
  const initialOraclePrice = toDecimals('0.00000000022', collateralTokenDecimals); // 1 token = inverse(0.005 link)
  const decimals = parseInt(await token.decimals());
  const lendingPoolDepositAmountWei = toDecimals(4000, decimals);
  const amountWei = toDecimals(800, decimals);
  const maxAmountWei = toDecimals(2000, decimals);
  const durationInDays = 60;
  const signers = await accounts.getAllAt(12, 13);
  const senderTxConfig = await accounts.getTxConfigAt(1);
  const initialCollateralAmount = toDecimals(10000, collateralTokenDecimals);
  await swapper.swapForExact([ swapper.wethAddress, collateralToken.address ], initialCollateralAmount, senderTxConfig)
  // await collateralToken.mint(senderTxConfig.from, initialCollateralAmount, senderTxConfig);
  const borrowerTxConfig = { from: borrower };
  await swapper.swapForExact([ swapper.wethAddress, token.address ], maxAmountWei, borrowerTxConfig)
  // await token.mint(borrowerTxConfig.from, maxAmountWei);

  // Sets Initial Oracle Price
  console.log(`Settings initial oracle price: 1 ${tokenName} = ${initialOraclePrice.toFixed(0)} = ${toUnits(initialOraclePrice, collateralTokenDecimals)} ${collateralTokenName}`);
  await chainlinkOracle.setLatestAnswer(initialOraclePrice);

  // Deposit tokens on lending pool.
  console.log('Depositing tokens on lending pool...');
  const lenderTxConfig = await accounts.getTxConfigAt(0);
  await swapper.swapForExact([ swapper.wethAddress, token.address ], lendingPoolDepositAmountWei, lenderTxConfig)
  await token.approve(lendingPoolInstance.address, lendingPoolDepositAmountWei, lenderTxConfig);
  const depositResult = await lendingPoolInstance.deposit(lendingPoolDepositAmountWei, lenderTxConfig);
  lendingPool
    .tokenDeposited(depositResult)
    .emitted(lenderTxConfig.from, lendingPoolDepositAmountWei);

  // Set loan terms.
  console.log('Setting loan terms...');
  const loanTermsRequestInfo = {
    borrower,
    recipient,
    requestNonce: nonces.newNonce(borrower),
    amount: amountWei.toFixed(0),
    duration: durationInDays * ONE_DAY,
    requestTime: currentTimestamp,
    caller: loansInstance.address,
    consensusAddress: loanTermConsensusInstance.address,
  };
  const loanResponseInfoTemplate = {
    responseTime: currentTimestamp - 10,
    interestRate: 400,
    collateralRatio: 600,
    maxLoanAmount: maxAmountWei.toFixed(0),
    consensusAddress: loanTermConsensusInstance.address,
  };
  const loanTermsRequest = createLoanTermsRequest(loanTermsRequestInfo, chainId);
  const signedResponses = await createMultipleSignedLoanTermsResponses(
    web3,
    loanTermsRequest,
    signers,
    loanResponseInfoTemplate,
    nonces,
    chainId,
  );

  await collateralToken.approve(loansInstance.address, initialCollateralAmount, borrowerTxConfig);

  const createLoanWithTermsResult = await loansInstance.createLoanWithTerms(
    loanTermsRequest.loanTermsRequest,
    signedResponses,
    initialCollateralAmount,
    borrowerTxConfig
  );

  const termsExpiryTime = await settingsInstance.getPlatformSettingValue(toBytes32(web3, platformSettingsNames.TermsExpiryTime));
  const expiryTermsExpected = await timer.getCurrentTimestampInSecondsAndSum(termsExpiryTime);
  const loanIDs = await loansInstance.getBorrowerLoans(borrower);
  const lastLoanID = loanIDs[loanIDs.length - 1];
  loans
    .loanTermsSet(createLoanWithTermsResult)
    .emitted(
      lastLoanID,
      borrowerTxConfig.from,
      recipient,
      loanResponseInfoTemplate.interestRate,
      loanResponseInfoTemplate.collateralRatio,
      loanResponseInfoTemplate.maxLoanAmount,
      loanTermsRequestInfo.duration,
      expiryTermsExpected,
    );

  console.log(`Advancing time to take out loan (current: ${(await timer.getCurrentDate())})...`);
  const nextTimestamp_1 = await timer.getCurrentTimestampInSecondsAndSum(minutesToSeconds(2));
  await timer.advanceBlockAtTime(nextTimestamp_1);
  
  // Take out a loan.
  console.log(`Taking out loan id ${lastLoanID}...`);
  const takeOutLoanResult = await loansInstance.takeOutLoan(lastLoanID, amountWei, borrowerTxConfig);
  const { escrow } = await loansInstance.loans(lastLoanID);
  loans
    .loanTakenOut(takeOutLoanResult)
    .emitted(lastLoanID, borrowerTxConfig.from, escrow, amountWei.toFixed(0));

  // Calculate payment
  console.log(`Making payment for loan id ${lastLoanID}...`);
  const initialLoanStatus = await loansInstance.loans(lastLoanID);
  const {
    principalOwed: principalOwedResult,
    interestOwed: interestOwedResult,
  } = initialLoanStatus;
  let totalOwedResult = BigNumber(principalOwedResult.toString())
                          .plus(BigNumber(interestOwedResult.toString()));
  const payment = totalOwedResult.dividedBy(4);

  // Advance time to make first payment 15 days later 
  console.log(`Advancing time to take out loan (current: ${(await timer.getCurrentDate())})...`);
  const paymentTimestamp = await timer.getCurrentTimestampInSecondsAndSum(daysToSeconds(15));
  await timer.advanceBlockAtTime(paymentTimestamp);

  totalOwedResult = totalOwedResult.minus(payment);

  // Make 1st payment
  console.log(`Repaying loan id ${lastLoanID}...`);
  console.log('Making 1st payment...');
  await token.approve(lendingPoolInstance.address, payment, borrowerTxConfig);
  const repay1_result = await loansInstance.repay(payment, lastLoanID, borrowerTxConfig);
  loans
    .loanRepaid(repay1_result)
    .emitted(lastLoanID, borrowerTxConfig.from, payment, borrowerTxConfig.from, totalOwedResult.toString());

  // Check loan status
  const firstLoanStatus = await loansInstance.loans(lastLoanID);
  const firstLoanStatusResult = firstLoanStatus.status;
  assert.equal(
    firstLoanStatusResult.toString(),
    BigNumber((2).toString()),
    'Invalid final loan staus.'
  );

  // Advance time to make first payment 30 days later 
  console.log(`Advancing time to take out loan (current: ${(await timer.getCurrentDate())})...`);
  const secondPaymentTimestamp = await timer.getCurrentTimestampInSecondsAndSum(daysToSeconds(15));
  await timer.advanceBlockAtTime(secondPaymentTimestamp);

  // Make 2nd payment
  console.log('Making 2nd payment...');
  await token.approve(lendingPoolInstance.address, payment, {from:borrower});
  totalOwedResult = totalOwedResult.minus(payment);
  const repay2_result = await loansInstance.repay(payment, lastLoanID, borrowerTxConfig);
  // Check loan status
  loans
    .loanRepaid(repay2_result)
    .emitted(lastLoanID, borrowerTxConfig.from, payment, borrowerTxConfig.from, totalOwedResult.toString());
  const secondLoanStatus = await loansInstance.loans(lastLoanID) 
  assert.equal(
    secondLoanStatus.status.toString(),
    loanStatuses.Active,
    'Invalid #2 loan staus.'
  );

  // Advance time to make first payment 45 days later 
  console.log(`Advancing time to take out loan (current: ${(await timer.getCurrentDate())})...`);
  const thirdPaymentTimestamp = await timer.getCurrentTimestampInSecondsAndSum(daysToSeconds(15));
  await timer.advanceBlockAtTime(thirdPaymentTimestamp);

  // Make 3rd payment
  console.log('Making 3rd payment...');
  await token.approve(lendingPoolInstance.address, payment, {from:borrower});
  const repay3_result = await loansInstance.repay(payment, lastLoanID, borrowerTxConfig);
  // Check loan status
  totalOwedResult = totalOwedResult.minus(payment);
  loans
    .loanRepaid(repay3_result)
    .emitted(lastLoanID, borrowerTxConfig.from, payment, borrowerTxConfig.from, totalOwedResult.toString());
  const thirdLoanStatus = await loansInstance.loans(lastLoanID) 
  assert.equal(
    thirdLoanStatus.status.toString(),
    loanStatuses.Active,
    'Invalid #3 loan staus.'
  );

  // Advance time to make first payment 55 days later 
  console.log(`Advancing time to take out loan (current: ${(await timer.getCurrentDate())})...`);
  const forthPaymentTimestamp = await timer.getCurrentTimestampInSecondsAndSum(daysToSeconds(10));
  await timer.advanceBlockAtTime(forthPaymentTimestamp);

  // Make 4th payment
  console.log('Making final payment...');
  await token.approve(lendingPoolInstance.address, payment, {from:borrower});
  const repay4_result = await loansInstance.repay(payment, lastLoanID, borrowerTxConfig);
  totalOwedResult = totalOwedResult.minus(payment);
  loans
    .loanRepaid(repay4_result)
    .emitted(lastLoanID, borrowerTxConfig.from, payment, borrowerTxConfig.from, totalOwedResult.toString());
  const loanStatus = await loansInstance.loans(lastLoanID);
  assert.equal(
    loanStatus.principalOwed,
    NON_EXISTENT,
    'Incorrect prinicpal owed.'
  );
  assert.equal(
    loanStatus.interestOwed,
    NON_EXISTENT,
    'Incorrect interest owed.'
  );
  assert.equal(
    loanStatus.status.toString(),
    loanStatuses.Closed,
    'Invalid final loan staus.'
  );

  const nextTimestamp = await timer.getCurrentTimestampInSecondsAndSum(minutesToSeconds(2000000));
  console.log(`Advancing time to create another loan (Current: ${(await timer.getCurrentDate())})...`);
  await timer.advanceBlockAtTime(nextTimestamp);
};