pragma solidity 0.5.17;

contract ForceSend {
    function go(address payable victim) external payable {
        selfdestruct(victim);
    }
}