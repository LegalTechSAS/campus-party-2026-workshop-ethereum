/** CLI de identidad y reputación; read consulta, register firma una transacción. */
import { SepoliaProtocol } from "../../infrastructure/ethereum/sepolia-protocol.mjs";
import { AgentReputation } from "../../infrastructure/ethereum/agent-reputation.mjs";
import {
  loadSepoliaConfig,
  publicError,
} from "../../infrastructure/config/sepolia-config.mjs";
let protocol;
try {
  const action = process.argv[2] || "read";
  if (!["read", "register"].includes(action)) throw Error("Usá read o register.");
  const root = process.cwd();
  protocol = new SepoliaProtocol(root, loadSepoliaConfig(root));
  [protocol.client, protocol.provider, protocol.evaluator] =
    await protocol.loadSigners();
  const reputation = new AgentReputation(root, protocol);
  console.log(
    JSON.stringify(
      await (action === "register" ? reputation.register() : reputation.read()),
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error.code === "ENOENT"
      ? "Primero ejecutá npm run agent:register."
      : publicError(error),
  );
  process.exitCode = 1;
} finally {
  protocol?.close();
}
