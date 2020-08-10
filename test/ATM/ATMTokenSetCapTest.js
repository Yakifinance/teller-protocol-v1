// JS Libraries
const withData = require('leche').withData;
const { t, NULL_ADDRESS  } = require('../utils/consts');
const { atmToken } = require('../utils/events');

// Smart contracts
const ATMToken = artifacts.require("./ATMToken.sol");

contract('ATMTokenSetCapTest', function (accounts) {
    let instance;
    const daoAgent = accounts[0];
    const daoMember1 = accounts[2];

    beforeEach('Setup for each test', async () => {
        instance = await ATMToken.new(
                                "ATMToken",
                                "ATMT",
                                18,
                                10000,
                                50
                            );
    });

    withData({
        _1_set_supply_cap_basic: [70000, daoAgent, undefined, false],
        _2_set_supply_cap_invalid_sender: [100000, daoMember1, 'CALLER_IS_NOT_OWNER', true]
    },function(
        newCap,
        sender,
        expectedErrorMessage,
        mustFail
    ) {
        it(t('agent', 'setCap', 'Should or should not be able to set cap correctly', mustFail), async function() {

            try {
                // Invocation
                const result = await instance.setCap(newCap, { from: sender });
                const cap = await instance.cap();
                // Assertions
                assert(!mustFail, 'It should have failed because the sender is invalid');
                assert.equal(
                    cap,
                    newCap,
                    'New supply cap not set!'
                );
                atmToken
                    .newCap(result)
                    .emitted(newCap);
                assert(result);
            } catch (error) {
                // Assertions
                assert(mustFail);
                assert(error);
                assert.equal(
                    error.reason,
                    expectedErrorMessage
                    );
            }

        });
    });

})