import { parseAbi } from 'viem';

export const walletAbi = parseAbi([
  'constructor(address token)',
  'function TOKEN() view returns (address)',
  'function IMPLEMENTATION() view returns (address)',
  'function VERSION() view returns (uint256)',
  'function grantCount() view returns (uint256)',
  'function grantIdAt(uint256) view returns (bytes32)',
  'function getGrant(bytes32) view returns ((address agent,address recipient,uint256 budget,uint256 spent,uint64 expiresAt,uint8 status))',
  'function paymentUsed(bytes32) view returns (bool)',
  'function createGrant(bytes32 id,address agent,address recipient,uint256 budget,uint64 expiresAt)',
  'function createGrantFor(address account,bytes32 id,address agent,address recipient,uint256 budget,uint64 expiresAt)',
  'function approveGrantFor(address account,bytes32 id)',
  'function rejectGrantFor(address account,bytes32 id)',
  'function revokeGrantFor(address account,bytes32 id)',
  'function approveGrant(bytes32 id)',
  'function rejectGrant(bytes32 id)',
  'function revokeGrant(bytes32 id)',
  'function pay(bytes32 grantId,bytes32 paymentId,address recipient,uint256 amount)',
  'event GrantRequested(bytes32 indexed grantId,address indexed agent,address recipient,uint256 budget,uint64 expiresAt)',
  'event GrantCreated(bytes32 indexed grantId,address indexed agent,address recipient,uint256 budget,uint64 expiresAt)',
  'event GrantStatusChanged(bytes32 indexed grantId,uint8 status)',
  'event Payment(bytes32 indexed paymentId,bytes32 indexed grantId,address indexed recipient,uint256 amount,uint256 totalSpent)',
  'error TestnetOnly()', 'error DelegatedOnly()', 'error OwnerOnly()', 'error InvalidTerms()',
  'error ImplementationOnly()', 'error InvalidDelegate()',
  'error GrantExists()', 'error InvalidStatus()', 'error WrongSigner()', 'error WrongRecipient()',
  'error Expired()', 'error BudgetExceeded()', 'error DuplicatePayment()', 'error TransferFailed()', 'error Reentrant()',
]);
export const tokenAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
]);
