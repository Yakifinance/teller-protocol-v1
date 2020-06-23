/*
    Copyright 2020 Fabrx Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

// Contracts
import "./LoansBase.sol";

// Interfaces
import "../interfaces/LoansInterface.sol";


contract TokenCollateralLoans is LoansInterface, LoansBase {
    /** Constants */

    /** Properties */

    ERC20Detailed public collateralToken;

    /** Modifiers */
    modifier noMsgValue() {
        require(msg.value == 0);
        _;
    }

    /** External Functions */

    /**
     * @notice Deposit collateral tokens into a loan.
     * @param borrower address The address of the loan borrower.
     * @param loanID uint256 The ID of the loan the collateral is for
     * @param amount to deposit as collateral.
     */
    function depositCollateral(address borrower, uint256 loanID, uint256 amount)
        external
        payable
        noMsgValue()
        loanActiveOrSet(loanID)
        isInitialized()
        whenNotPaused()
        whenLendingPoolNotPaused(address(lendingPool))
    {
        require(
            loans[loanID].loanTerms.borrower == borrower,
            "BORROWER_LOAN_ID_MISMATCH"
        );
        require(amount > 0, "CANNOT_DEPOSIT_ZERO");

        // Update the loan collateral and total. Transfer tokens to this contract.
        _payInCollateral(loanID, amount);

        emit CollateralDeposited(loanID, borrower, amount);
    }

    function setLoanTerms(
        ZeroCollateralCommon.LoanRequest calldata request,
        ZeroCollateralCommon.LoanResponse[] calldata responses,
        uint256 collateralAmount
    )
        external
        payable
        noMsgValue()
        isInitialized()
        whenNotPaused()
        isBorrower(request.borrower)
    {
        uint256 loanID = getAndIncrementLoanID();

        (
            uint256 interestRate,
            uint256 collateralRatio,
            uint256 maxLoanAmount
        ) = loanTermsConsensus.processRequest(request, responses);

        loans[loanID] = createLoan(
            loanID,
            request,
            interestRate,
            collateralRatio,
            maxLoanAmount
        );

        if (collateralAmount > 0) {
            // Update collateral, totalCollateral, and lastCollateralIn
            _payInCollateral(loanID, collateralAmount);
        }

        borrowerLoans[request.borrower].push(loanID);

        emit LoanTermsSet(
            loanID,
            request.borrower,
            request.recipient,
            interestRate,
            collateralRatio,
            maxLoanAmount,
            request.duration,
            loans[loanID].termsExpiry
        );
        if (collateralAmount > 0) {
            emit CollateralDeposited(loanID, request.borrower, collateralAmount);
        }
    }

    function initialize(
        address priceOracleAddress,
        address lendingPoolAddress,
        address loanTermsConsensusAddress,
        address settingsAddress,
        address collateralTokenAddress
    ) external isNotInitialized() {
        require(collateralTokenAddress != address(0x0), "PROVIDE_COLL_TOKEN_ADDRESS");

        _initialize(
            priceOracleAddress,
            lendingPoolAddress,
            loanTermsConsensusAddress,
            settingsAddress
        );

        collateralToken = ERC20Detailed(collateralTokenAddress);
    }

    /** Internal Function */

    function _payOutCollateral(uint256 loanID, uint256 amount, address payable recipient)
        internal
    {
        totalCollateral = totalCollateral.sub(amount);
        loans[loanID].collateral = loans[loanID].collateral.sub(amount);
        collateralTokenTransfer(recipient, amount);
    }

    function _payInCollateral(uint256 loanID, uint256 amount) internal {
        // Update the total collateral and loan collateral
        super._payInCollateral(loanID, amount);
        // Transfer collateral tokens to this contract.
        collateralTokenTransferFrom(msg.sender, amount);
    }

    function _emitCollateralWithdrawnEvent(
        uint256 loanID,
        address payable recipient,
        uint256 amount
    ) internal {
        emit CollateralWithdrawn(loanID, recipient, amount);
    }

    function _emitLoanTakenOutEvent(uint256 loanID, uint256 amountBorrow) internal {
        emit LoanTakenOut(loanID, loans[loanID].loanTerms.borrower, amountBorrow);
    }

    function _emitLoanRepaidEvent(
        uint256 loanID,
        uint256 amountPaid,
        address payer,
        uint256 totalOwed
    ) internal {
        emit LoanRepaid(
            loanID,
            loans[loanID].loanTerms.borrower,
            amountPaid,
            payer,
            totalOwed
        );
    }

    function _emitLoanLiquidatedEvent(
        uint256 loanID,
        address liquidator,
        uint256 collateralOut,
        uint256 tokensIn
    ) internal {
        emit LoanLiquidated(
            loanID,
            loans[loanID].loanTerms.borrower,
            liquidator,
            collateralOut,
            tokensIn
        );
    }

    /** Private Functions */

    /**
        @notice It transfers an amount of collateral tokens to a specific address.
        @param recipient address which will receive the tokens.
        @param amount of tokens to transfer.
        @dev It throws a require error if 'transfer' invocation fails.
     */
    function collateralTokenTransfer(address recipient, uint256 amount) private {
        uint256 currentBalance = collateralToken.balanceOf(address(this));
        require(currentBalance >= amount, "NOT_ENOUGH_COLL_TOKENS_BALANCE");
        bool transferResult = collateralToken.transfer(recipient, amount);
        require(transferResult, "COLL_TOKENS_TRANSFER_FAILED");
    }

    /**
        @notice It transfers an amount of collateral tokens from an address to this contract.
        @param from address where the tokens will transfer from.
        @param amount to be transferred.
        @dev It throws a require error if the allowance is not enough.
        @dev It throws a require error if 'transferFrom' invocation fails.
     */
    function collateralTokenTransferFrom(address from, uint256 amount) private {
        uint256 currentAllowance = collateralToken.allowance(from, address(this));
        require(currentAllowance >= amount, "NOT_ENOUGH_COLL_TOKENS_ALLOWANCE");
        bool transferFromResult = collateralToken.transferFrom(
            from,
            address(this),
            amount
        );
        require(transferFromResult, "COLL_TOKENS_FROM_TRANSFER_FAILED");
    }
}
