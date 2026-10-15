import { AgentContext, grantLink, publicError } from 'agent-wallet-cli/agent';
import { args, stateDir } from './local';

try {
  const result = await grantLink(new AgentContext(stateDir), args(['agent', 'recipient', 'budget', 'expires', 'grant-id']));
  console.log(`Alice creates and authorizes this grant in MetaMask:\n${result.approvalUrl}\nGrant ID: ${result.grantId}\nNo transaction was signed or submitted.`);
} catch (error) { console.error(publicError(error).message); process.exitCode = 1; }
