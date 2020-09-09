module.exports = {
    teller: {
        name: 'Teller',
        token: {
            name: 'Teller Token',
            symbol: 'TLR',
            decimals: 18,
            maxCap: 100000000,
            maxVestingPerWallet: 50,
        },
        supplyToDebt: 5000,
        /**
            It represents the ATM that will be used by each market. So, a market has only one ATM.
         */
        markets: [
            { borrowedToken: 'DAI', collateralToken: 'ETH' },
            { borrowedToken: 'DAI', collateralToken: 'LINK' },
            { borrowedToken: 'USDC', collateralToken: 'ETH' },
            { borrowedToken: 'USDC', collateralToken: 'LINK' },
        ],
    },
};
