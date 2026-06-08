// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title QUAISToken
 * @notice The $QAIS utility token: fixed supply, no mint function after deployment.
 *         Used as the payment medium (escrow) and node stake/collateral.
 * @dev Burnable (holders and the protocol can permanently reduce supply). The full
 *      60/20/20 treasury split is deferred; for the MVP the burn primitive exists and
 *      protocol fees accrue to a treasury address handled by JobEscrow.
 *
 *      Total supply (1,000,000,000 QAIS) is minted once to `initialHolder` at
 *      construction. There is intentionally no `mint` — supply can only ever decrease.
 */
contract QUAISToken is ERC20Burnable {
    /// @notice Fixed total supply minted at construction: 1,000,000,000 * 1e18.
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    /// @param initialHolder Receives the entire initial supply (the deployer/treasury bootstrap).
    constructor(address initialHolder) ERC20("QueraIS Token", "QAIS") {
        require(initialHolder != address(0), "QAIS: zero holder");
        _mint(initialHolder, INITIAL_SUPPLY);
    }
}
