// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Throwaway spike (TRD §7.4): who is msg.sender, and what unit is msg.value, on Hedera EVM?
contract WhoAmI {
    event Echo(address sender, uint256 value);

    function whoami() external view returns (address) {
        return msg.sender;
    }

    /// Emits the values so a real transaction (not just eth_call) proves them.
    function echoValue() external payable returns (uint256) {
        emit Echo(msg.sender, msg.value);
        return msg.value;
    }
}
