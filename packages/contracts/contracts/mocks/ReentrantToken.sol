// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReentryTarget {
    function verifyAndRelease(bytes32 jobId) external;
}

/**
 * @title ReentrantToken
 * @notice Test-only malicious ERC-20: on its first outbound `transfer` it attempts to
 *         re-enter JobEscrow.verifyAndRelease for the same job. Used to prove the
 *         nonReentrant guard + CEI ordering prevent double settlement / draining.
 * @dev NOT part of the deployed system — lives under contracts/mocks for tests only.
 */
contract ReentrantToken is ERC20 {
    IReentryTarget public target;
    bytes32 public jobId;
    bool public armed;

    constructor() ERC20("Reentrant", "RENT") {
        _mint(msg.sender, 1_000_000_000 ether);
    }

    /// @notice Mint helper so tests can fund arbitrary accounts.
    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Arm the attack: the next `transfer` will re-enter `target` once.
    function arm(address target_, bytes32 jobId_) external {
        target = IReentryTarget(target_);
        jobId = jobId_;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false; // single shot
            target.verifyAndRelease(jobId); // expected to revert via ReentrancyGuard
        }
        return super.transfer(to, amount);
    }
}
