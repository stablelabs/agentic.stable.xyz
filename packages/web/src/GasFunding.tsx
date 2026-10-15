import { useEffect, useState } from 'react';
import { formatUnits, type Address, type Hex } from 'viem';
import { parseAmount, type WalletConfig, publicClient, type Grant, fundingSuggestion, NATIVE_PER_TOKEN_UNIT, createOwnerClient } from 'agent-wallet-sdk';

export default function GasFunding({ config, id, grant, connected, busy, onFund }: {
  config: WalletConfig; id: Hex; grant: Grant; connected: boolean; busy: boolean;
  onFund: (id: Hex, agent: Address, amount: bigint) => Promise<void>;
}) {
  const [balance, setBalance] = useState<bigint>();
  const [reserve, setReserve] = useState<bigint>();
  const [amount, setAmount] = useState('');
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState('');
  const [inputError, setInputError] = useState('');
  const [checking, setChecking] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    const owner = createOwnerClient({ config, publicClient: publicClient(config.rpcUrl) });
    setChecking(true);
    setError('');
    // Balance is useful even when a payment cannot currently be estimated.
    void Promise.all([
      owner.getBalances(grant.agent).then(value => { if (alive) setBalance(value.agentNative); }).catch(() => { if (alive) { setBalance(undefined); setError('Agent gas balance unavailable. Retry the gas check.'); } }),
      owner.estimateAgentGas(id).then(value => { if (alive) setReserve(value.reserve); }).catch(() => { if (alive) { setReserve(undefined); setError('Payment gas estimate unavailable. Refresh the grant and retry the gas check.'); } }),
    ]).finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [config, id, grant, revision]);
  const suggested = balance !== undefined && reserve !== undefined ? fundingSuggestion(balance, reserve) : undefined;
  useEffect(() => { if (!edited && suggested !== undefined) setAmount(suggested > 0n ? formatUnits(suggested, 18) : ''); }, [edited, suggested]);
  const ready = !checking && !error && balance !== undefined && reserve !== undefined && balance >= reserve;
  return <section className={`gas-panel ${ready ? 'ready' : 'needs-gas'}`} aria-label="Agent gas funding">
    <div className="gas-heading"><h4>Agent gas</h4><span className="status">{checking ? 'Checking gas…' : error ? 'Gas status unavailable' : ready ? 'Enough for estimated payment gas' : 'Gas funding needed'}</span></div>
    <p className="gas-balance">Agent balance: <strong>{balance === undefined ? 'Checking…' : `${formatUnits(balance, 18)} native USDT0`}</strong></p>
    {reserve !== undefined && <p>Estimated reserve for one payment: <strong>{formatUnits(reserve, 18)} USDT0</strong>. Includes a gas and fee buffer; costs can change.</p>}
    {!ready && !checking && !error && <p><strong>Next: Alice funds the agent for gas.</strong> The grant is active, but the agent needs its own balance to submit payments.</p>}
    <p>Funding goes to <code>{grant.agent}</code>. This is a separate transfer from Alice, outside the grant budget. Alice also pays the transfer fee.</p>
    {suggested !== undefined && suggested > 0n && <p>Suggested top-up: <strong>{formatUnits(suggested, 18)} USDT0</strong> to bring the balance to three estimated payments.</p>}
    {error && <p className="gas-error">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); try { const value = parseAmount(amount) * NATIVE_PER_TOKEN_UNIT; setInputError(''); void onFund(id, grant.agent, value); } catch (e) { setInputError((e as Error).message); } }}>
      <label>Gas funding amount (USDT0)<input required inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setEdited(true); setInputError(''); }} disabled={busy} placeholder="0.01" /></label>
      <div className="gas-actions"><button className="primary" type="submit" disabled={!connected || busy || checking || balance === undefined}>Fund agent gas</button><button type="button" disabled={busy || checking} onClick={() => setRevision(value => value + 1)}>Check gas balance</button></div>
      {inputError && <p role="alert" className="gas-error">{inputError}</p>}
    </form>
  </section>;
}
