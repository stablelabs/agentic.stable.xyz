// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {AgentWallet} from "../contracts/AgentWallet.sol";
import {AgentWalletV1} from "./fixtures/AgentWalletV1.sol";

interface Vm {
    struct SignedDelegation {
        uint8 v;
        bytes32 r;
        bytes32 s;
        uint64 nonce;
        address implementation;
    }
    function addr(uint256) external returns (address);
    function prank(address) external;
    function expectRevert(bytes4) external;
    function warp(uint256) external;
    function chainId(uint256) external;
    function signAndAttachDelegation(address, uint256) external returns (SignedDelegation memory);
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    uint8 public constant decimals = 6;
    string public constant symbol = "USDT0";
    uint8 public failure;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setFailure(uint8 value) external {
        failure = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failure == 1) return false;
        require(failure != 2, "token failure");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (failure == 3) assembly { return(0, 0) }
        return true;
    }
}

contract AgentWalletTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant ALICE_KEY = 0xA11CE;
    address alice;
    address constant AGENT = address(0xB0B);
    address constant RECIPIENT = address(0xCAFE);
    bytes32 constant GRANT = bytes32(uint256(1));
    bytes32 constant PAYMENT = bytes32(uint256(2));
    MockToken token;
    AgentWallet implementation;
    AgentWallet wallet;

    function setUp() public {
        vm.chainId(2201);
        vm.warp(1000);
        alice = vm.addr(ALICE_KEY);
        token = new MockToken();
        implementation = new AgentWallet(address(token));
        AgentWalletV1 legacy = new AgentWalletV1(address(token));
        vm.signAndAttachDelegation(address(legacy), ALICE_KEY);
        vm.prank(AGENT);
        AgentWalletV1(payable(alice)).requestGrant(GRANT, RECIPIENT, 10_000, 2000);
        vm.signAndAttachDelegation(address(implementation), ALICE_KEY);
        wallet = AgentWallet(payable(alice));
        token.mint(alice, 1_000_000);
    }

    function activate() internal {
        vm.prank(alice);
        wallet.approveGrant(GRANT);
    }

    function pay(bytes32 id, uint256 amount) internal {
        vm.prank(AGENT);
        wallet.pay(GRANT, id, RECIPIENT, amount);
    }

    function unchanged(bytes32 id) internal view {
        require(wallet.getGrant(GRANT).spent == 0 && !wallet.paymentUsed(id), "accounting changed");
        require(token.balanceOf(alice) == 1_000_000 && token.balanceOf(RECIPIENT) == 0, "funds moved");
    }

    function testActivationAtExistingAddress() public view {
        require(wallet.VERSION() == 3, "wrong version");
        require(alice.code.length == 23, "not a delegation indicator");
        require(wallet.IMPLEMENTATION() == address(implementation) && wallet.TOKEN() == address(token), "metadata");
        require(wallet.grantIdAt(0) == GRANT && wallet.getGrant(GRANT).agent == AGENT, "request");
    }

    function testAliceCreatesActiveGrantAndAgentCannotCreateOrChangeIt() public {
        bytes32 id = bytes32(uint256(77));
        vm.expectRevert(AgentWallet.OwnerOnly.selector);
        vm.prank(AGENT);
        wallet.createGrant(id, AGENT, RECIPIENT, 10000, 2000);
        vm.prank(alice);
        wallet.createGrant(id, AGENT, RECIPIENT, 10000, 2000);
        AgentWallet.Grant memory g = wallet.getGrant(id);
        require(g.status == AgentWallet.Status.Active && g.agent == AGENT && g.spent == 0, "creation terms");
        vm.prank(AGENT);
        wallet.pay(id, PAYMENT, RECIPIENT, 6000);
        require(token.balanceOf(RECIPIENT) == 6000, "payment");
        vm.expectRevert(AgentWallet.GrantExists.selector);
        vm.prank(alice);
        wallet.createGrant(id, AGENT, RECIPIENT, 20000, 2000);
    }

    function testOwnerForwarderCreatesAndRevokesForAlice() public {
        bytes32 id = bytes32(uint256(80));
        vm.prank(alice);
        implementation.createGrantFor(alice, id, AGENT, RECIPIENT, 10000, 2000);
        require(wallet.getGrant(id).status == AgentWallet.Status.Active, "forwarded creation");
        vm.prank(AGENT);
        wallet.pay(id, PAYMENT, RECIPIENT, 6000);
        vm.prank(alice);
        implementation.revokeGrantFor(alice, id);
        require(wallet.getGrant(id).status == AgentWallet.Status.Revoked, "forwarded revocation");
    }

    function testForwarderCannotBeCalledByAgentForAliceOrThroughDelegatedContext() public {
        vm.expectRevert(AgentWallet.OwnerOnly.selector);
        vm.prank(AGENT);
        implementation.createGrantFor(alice, bytes32(uint256(80)), AGENT, RECIPIENT, 10000, 2000);
        vm.expectRevert(AgentWallet.OwnerOnly.selector);
        vm.prank(AGENT);
        implementation.approveGrantFor(alice, GRANT);
        vm.expectRevert(AgentWallet.OwnerOnly.selector);
        vm.prank(AGENT);
        implementation.rejectGrantFor(alice, GRANT);
        vm.expectRevert(AgentWallet.OwnerOnly.selector);
        vm.prank(AGENT);
        implementation.revokeGrantFor(alice, GRANT);
        vm.expectRevert(AgentWallet.ImplementationOnly.selector);
        vm.prank(alice);
        wallet.createGrantFor(alice, bytes32(uint256(80)), AGENT, RECIPIENT, 10000, 2000);
        require(wallet.grantCount() == 1, "unauthorized grant created");
    }

    function testForwarderRejectsUnrelatedAccountAndWrongImplementation() public {
        vm.expectRevert(AgentWallet.OwnerOnly.selector);
        vm.prank(alice);
        implementation.createGrantFor(AGENT, bytes32(uint256(80)), AGENT, RECIPIENT, 10000, 2000);
        vm.expectRevert(AgentWallet.InvalidDelegate.selector);
        vm.prank(AGENT);
        implementation.createGrantFor(AGENT, bytes32(uint256(80)), AGENT, RECIPIENT, 10000, 2000);
        AgentWallet other = new AgentWallet(address(token));
        vm.expectRevert(AgentWallet.InvalidDelegate.selector);
        vm.prank(alice);
        other.createGrantFor(alice, bytes32(uint256(80)), AGENT, RECIPIENT, 10000, 2000);
    }

    function testForwardedLegacyApprovalAndRejection() public {
        vm.prank(alice);
        implementation.approveGrantFor(alice, GRANT);
        require(wallet.getGrant(GRANT).status == AgentWallet.Status.Active, "approval");
    }

    function testForwardedLegacyRejection() public {
        vm.prank(alice);
        implementation.rejectGrantFor(alice, GRANT);
        require(wallet.getGrant(GRANT).status == AgentWallet.Status.Rejected, "rejection");
    }

    function testLegacySpendingAndPaymentIdsSurviveUpgrade() public {
        uint256 key = ALICE_KEY + 1;
        address oldAlice = vm.addr(key);
        AgentWalletV1 legacy = new AgentWalletV1(address(token));
        vm.signAndAttachDelegation(address(legacy), key);
        AgentWalletV1 oldWallet = AgentWalletV1(payable(oldAlice));
        token.mint(oldAlice, 10000);
        vm.prank(AGENT);
        oldWallet.requestGrant(GRANT, RECIPIENT, 10000, 2000);
        vm.prank(oldAlice);
        oldWallet.approveGrant(GRANT);
        vm.prank(AGENT);
        oldWallet.pay(GRANT, PAYMENT, RECIPIENT, 6000);
        vm.signAndAttachDelegation(address(implementation), key);
        AgentWallet upgraded = AgentWallet(payable(oldAlice));
        require(
            upgraded.grantCount() == 1 && upgraded.getGrant(GRANT).spent == 6000 && upgraded.paymentUsed(PAYMENT),
            "storage lost"
        );
        vm.expectRevert(AgentWallet.DuplicatePayment.selector);
        vm.prank(AGENT);
        upgraded.pay(GRANT, PAYMENT, RECIPIENT, 1);
        vm.expectRevert(AgentWallet.BudgetExceeded.selector);
        vm.prank(AGENT);
        upgraded.pay(GRANT, bytes32(uint256(3)), RECIPIENT, 6000);
        vm.prank(AGENT);
        upgraded.pay(GRANT, bytes32(uint256(4)), RECIPIENT, 4000);
        require(upgraded.getGrant(GRANT).spent == 10000 && token.balanceOf(oldAlice) == 0, "remaining funds");
    }

    function testBudgetAcceptanceAndRemainingFundsAvailable() public {
        activate();
        pay(PAYMENT, 6000);
        require(wallet.getGrant(GRANT).spent == 6000 && token.balanceOf(RECIPIENT) == 6000, "first payment");
        vm.expectRevert(AgentWallet.BudgetExceeded.selector);
        pay(bytes32(uint256(3)), 6000);
        require(token.balanceOf(alice) == 994000 && wallet.getGrant(GRANT).spent == 6000, "blocked funds changed");
        require(!wallet.paymentUsed(bytes32(uint256(3))), "blocked id consumed");
        pay(bytes32(uint256(4)), 4000);
        vm.expectRevert(AgentWallet.BudgetExceeded.selector);
        pay(bytes32(uint256(5)), 1);
    }

    function testPendingCannotPay() public {
        vm.expectRevert(AgentWallet.InvalidStatus.selector);
        pay(PAYMENT, 6000);
        unchanged(PAYMENT);
    }

    function testRejectedCannotPayOrApprove() public {
        vm.prank(alice);
        wallet.rejectGrant(GRANT);
        vm.expectRevert(AgentWallet.InvalidStatus.selector);
        pay(PAYMENT, 6000);
        unchanged(PAYMENT);
        vm.expectRevert(AgentWallet.InvalidStatus.selector);
        vm.prank(alice);
        wallet.approveGrant(GRANT);
    }

    function testRevokedCannotPayOrReactivate() public {
        activate();
        vm.prank(alice);
        wallet.revokeGrant(GRANT);
        vm.expectRevert(AgentWallet.InvalidStatus.selector);
        pay(PAYMENT, 6000);
        unchanged(PAYMENT);
        vm.expectRevert(AgentWallet.InvalidStatus.selector);
        vm.prank(alice);
        wallet.approveGrant(GRANT);
    }

    function testExpiryAtBoundary() public {
        activate();
        vm.warp(2000);
        vm.expectRevert(AgentWallet.Expired.selector);
        pay(PAYMENT, 6000);
        unchanged(PAYMENT);
    }

    function testExpiredPendingCannotApprove() public {
        vm.warp(2000);
        vm.expectRevert(AgentWallet.Expired.selector);
        vm.prank(alice);
        wallet.approveGrant(GRANT);
    }

    function testWrongSigner() public {
        activate();
        vm.expectRevert(AgentWallet.WrongSigner.selector);
        vm.prank(address(0xBAD));
        wallet.pay(GRANT, PAYMENT, RECIPIENT, 6000);
        unchanged(PAYMENT);
    }

    function testWrongRecipient() public {
        activate();
        vm.expectRevert(AgentWallet.WrongRecipient.selector);
        vm.prank(AGENT);
        wallet.pay(GRANT, PAYMENT, address(0xBAD), 6000);
        unchanged(PAYMENT);
    }

    function testDuplicatePaymentAcrossGrants() public {
        activate();
        pay(PAYMENT, 1000);
        vm.expectRevert(AgentWallet.DuplicatePayment.selector);
        pay(PAYMENT, 1000);
        bytes32 second = bytes32(uint256(99));
        vm.prank(alice);
        wallet.createGrant(second, AGENT, RECIPIENT, 10000, 2000);
        vm.expectRevert(AgentWallet.DuplicatePayment.selector);
        vm.prank(AGENT);
        wallet.pay(second, PAYMENT, RECIPIENT, 1000);
        require(token.balanceOf(RECIPIENT) == 1000 && wallet.getGrant(second).spent == 0, "duplicate moved funds");
    }

    function testOnlyAliceCanChangeStatus() public {
        vm.expectRevert(AgentWallet.OwnerOnly.selector);
        vm.prank(AGENT);
        wallet.approveGrant(GRANT);
        vm.expectRevert(AgentWallet.OwnerOnly.selector);
        vm.prank(AGENT);
        wallet.rejectGrant(GRANT);
        activate();
        vm.expectRevert(AgentWallet.OwnerOnly.selector);
        vm.prank(AGENT);
        wallet.revokeGrant(GRANT);
    }

    function testTerminalTransitionsAndGrantIds() public {
        vm.expectRevert(AgentWallet.GrantExists.selector);
        vm.prank(alice);
        wallet.createGrant(GRANT, AGENT, RECIPIENT, 100, 2000);
        vm.expectRevert(AgentWallet.InvalidStatus.selector);
        vm.prank(alice);
        wallet.revokeGrant(GRANT);
        activate();
        vm.expectRevert(AgentWallet.InvalidStatus.selector);
        vm.prank(alice);
        wallet.rejectGrant(GRANT);
    }

    function testTokenFailureRollsBackEverythingAndIdCanBeRetried() public {
        activate();
        token.setFailure(1);
        vm.expectRevert(AgentWallet.TransferFailed.selector);
        pay(PAYMENT, 6000);
        unchanged(PAYMENT);
        token.setFailure(2);
        vm.expectRevert(AgentWallet.TransferFailed.selector);
        pay(PAYMENT, 6000);
        unchanged(PAYMENT);
        token.setFailure(0);
        pay(PAYMENT, 6000);
    }

    function testNoReturnToken() public {
        activate();
        token.setFailure(3);
        pay(PAYMENT, 6000);
        require(wallet.getGrant(GRANT).spent == 6000, "no return failed");
    }

    function testZeroAmountAndId() public {
        activate();
        vm.expectRevert(AgentWallet.InvalidTerms.selector);
        pay(bytes32(0), 1);
        vm.expectRevert(AgentWallet.InvalidTerms.selector);
        pay(PAYMENT, 0);
        unchanged(PAYMENT);
    }

    function testDirectImplementationCannotMutate() public {
        vm.expectRevert(AgentWallet.DelegatedOnly.selector);
        implementation.createGrant(bytes32(uint256(9)), AGENT, RECIPIENT, 1, 2000);
    }

    function testMainnetBlocked() public {
        vm.chainId(988);
        vm.expectRevert(AgentWallet.TestnetOnly.selector);
        pay(PAYMENT, 1);
        vm.expectRevert(AgentWallet.TestnetOnly.selector);
        new AgentWallet(address(token));
    }

    function testFuzzCumulativeBudget(uint256 first, uint256 second) public {
        first = first % 10_000 + 1;
        second = second % 10_000 + 1;
        activate();
        pay(PAYMENT, first);
        if (second > 10_000 - first) vm.expectRevert(AgentWallet.BudgetExceeded.selector);
        pay(bytes32(uint256(3)), second);
        uint256 spent = wallet.getGrant(GRANT).spent;
        require(spent <= 10_000 && token.balanceOf(RECIPIENT) == spent, "budget invariant");
    }
}
