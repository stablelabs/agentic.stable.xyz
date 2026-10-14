// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Testnet-only EIP-7702 delegate. Alice creates grants; the agent only pays.
/// @dev The owner sends a transaction from its own EOA to that same EOA.
contract AgentWalletV2 {
    enum Status {
        None,
        Pending,
        Active,
        Rejected,
        Revoked
    }

    struct Grant {
        address agent;
        address recipient;
        uint256 budget;
        uint256 spent;
        uint64 expiresAt;
        Status status;
    }

    struct Layout {
        mapping(bytes32 => Grant) grants;
        bytes32[] ids;
        mapping(bytes32 => bool) payments;
        bool entered;
    }
    // Isolated namespace; delegation replacement must explicitly preserve this layout.
    // ERC-7201: keccak256(abi.encode(uint256(keccak256(namespace)) - 1)) & ~bytes32(uint256(0xff)).
    bytes32 private constant SLOT = 0xce0f974568baf86b675fc479fc456c4ba80f9e093a7d1a501066d45ccf3bab00;
    address public immutable TOKEN;
    address public immutable IMPLEMENTATION;
    uint256 public constant VERSION = 2;

    error TestnetOnly();
    error DelegatedOnly();
    error OwnerOnly();
    error InvalidTerms();
    error GrantExists();
    error InvalidStatus();
    error WrongSigner();
    error WrongRecipient();
    error Expired();
    error BudgetExceeded();
    error DuplicatePayment();
    error TransferFailed();
    error Reentrant();

    event GrantCreated(
        bytes32 indexed grantId, address indexed agent, address recipient, uint256 budget, uint64 expiresAt
    );
    event GrantStatusChanged(bytes32 indexed grantId, Status status);
    event Payment(
        bytes32 indexed paymentId,
        bytes32 indexed grantId,
        address indexed recipient,
        uint256 amount,
        uint256 totalSpent
    );

    constructor(address token) {
        if (block.chainid != 2201) revert TestnetOnly();
        if (token.code.length == 0) revert InvalidTerms();
        TOKEN = token;
        IMPLEMENTATION = address(this);
    }

    modifier delegated() {
        if (block.chainid != 2201) revert TestnetOnly();
        if (address(this) == IMPLEMENTATION) revert DelegatedOnly();
        _;
    }
    modifier owner() {
        if (msg.sender != address(this)) revert OwnerOnly();
        _;
    }

    function layout() private pure returns (Layout storage l) {
        bytes32 slot = SLOT;
        assembly { l.slot := slot }
    }

    function grantCount() external view returns (uint256) {
        return layout().ids.length;
    }

    function grantIdAt(uint256 index) external view returns (bytes32) {
        return layout().ids[index];
    }

    function getGrant(bytes32 id) external view returns (Grant memory) {
        return layout().grants[id];
    }

    function paymentUsed(bytes32 id) external view returns (bool) {
        return layout().payments[id];
    }

    function createGrant(bytes32 id, address agent, address recipient, uint256 budget, uint64 expiresAt)
        external
        delegated
        owner
    {
        if (
            id == bytes32(0) || recipient == address(0) || recipient == address(this) || budget == 0
                || expiresAt <= block.timestamp || agent == address(0) || agent == address(this)
        ) revert InvalidTerms();
        Layout storage l = layout();
        if (l.grants[id].status != Status.None) revert GrantExists();
        l.grants[id] = Grant({
            agent: agent, recipient: recipient, budget: budget, spent: 0, expiresAt: expiresAt, status: Status.Active
        });
        l.ids.push(id);
        emit GrantCreated(id, agent, recipient, budget, expiresAt);
        emit GrantStatusChanged(id, Status.Active);
    }

    function approveGrant(bytes32 id) external delegated owner {
        Grant storage g = layout().grants[id];
        if (g.status != Status.Pending) revert InvalidStatus();
        if (block.timestamp >= g.expiresAt) revert Expired();
        g.status = Status.Active;
        emit GrantStatusChanged(id, Status.Active);
    }

    function rejectGrant(bytes32 id) external delegated owner {
        Grant storage g = layout().grants[id];
        if (g.status != Status.Pending) revert InvalidStatus();
        g.status = Status.Rejected;
        emit GrantStatusChanged(id, Status.Rejected);
    }

    function revokeGrant(bytes32 id) external delegated owner {
        Grant storage g = layout().grants[id];
        if (g.status != Status.Active) revert InvalidStatus();
        g.status = Status.Revoked;
        emit GrantStatusChanged(id, Status.Revoked);
    }

    function pay(bytes32 grantId, bytes32 paymentId, address recipient, uint256 amount) external delegated {
        Layout storage l = layout();
        if (l.entered) revert Reentrant();
        Grant storage g = l.grants[grantId];
        if (g.status != Status.Active) revert InvalidStatus();
        if (msg.sender != g.agent) revert WrongSigner();
        if (recipient != g.recipient) revert WrongRecipient();
        if (block.timestamp >= g.expiresAt) revert Expired();
        if (paymentId == bytes32(0) || amount == 0) revert InvalidTerms();
        if (l.payments[paymentId]) revert DuplicatePayment();
        if (amount > g.budget - g.spent) revert BudgetExceeded();
        l.entered = true;
        l.payments[paymentId] = true;
        g.spent += amount;
        // All accounting rolls back if the token reverts, returns false, or returns malformed data.
        (bool ok, bytes memory result) =
            TOKEN.call(abi.encodeWithSignature("transfer(address,uint256)", recipient, amount));
        if (!ok || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) {
            revert TransferFailed();
        }
        l.entered = false;
        emit Payment(paymentId, grantId, recipient, amount, g.spent);
    }
    receive() external payable {}
}
