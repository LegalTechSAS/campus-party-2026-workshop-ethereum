/**
 * Token didáctico ERC-20: se llama Campus y su símbolo es CAMPUS.
 * Se usa para observar depósitos, pagos y devoluciones en Ethereum local.
 * No representa dinero real ni tiene valor fuera de esta práctica.
 */

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// Token exclusivamente didáctico, sin valor ni respaldo.
contract WorkshopToken is ERC20 {
    // Crea el token y asigna toda la oferta inicial a la cuenta cliente del taller.
    constructor(address client) ERC20("Campus", "CAMPUS") {
        // ERC-20 usa 18 decimales por defecto. Aquí ether es solo una unidad de
        // Solidity: 1000 * 10^18 unidades mínimas equivalen a 1000 CAMPUS; no se acuña ETH.
        _mint(client, 1000 ether);
    }
}
