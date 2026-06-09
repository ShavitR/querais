// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title ReentrantBatchToken
 * @notice Test-only malicious ERC-20: on its first outbound `transfer` it re-enters a target
 *         with pre-armed calldata (e.g. CreditAccount.batchSettle) and bubbles up the nested
 *         revert. Used to prove CreditAccount's nonReentrant guard + CEI ordering stop a
 *         re-entrant settlement from double-spending a deposit.
 * @dev NOT part of the deployed system — lives under contracts/mocks for tests only.
 */
contract ReentrantBatchToken is ERC20 {
    address public target;
    bytes public reentryData;
    bool public armed;

    constructor() ERC20("ReentrantBatch", "RB") {
        _mint(msg.sender, 1_000_000_000 ether);
    }

    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arm the attack: the next `transfer` re-enters `target_` with `data_` once.
    function arm(address target_, bytes calldata data_) external {
        target = target_;
        reentryData = data_;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false; // single shot
            (bool ok, bytes memory ret) = target.call(reentryData);
            if (!ok) {
                // Bubble the nested revert so the outer settlement reverts too.
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
        return super.transfer(to, amount);
    }
}
