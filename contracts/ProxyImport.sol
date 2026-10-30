/**
 * Incluye el proxy ERC-1967 de OpenZeppelin en la compilación.
 * El despliegue del taller usa este artefacto para separar la dirección y
 * el almacenamiento del contrato de su implementación actual.
 */

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
