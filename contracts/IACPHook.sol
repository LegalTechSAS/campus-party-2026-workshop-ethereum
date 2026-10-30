/**
 * Interfaz de extensiones opcionales del protocolo. Un hook es un contrato
 * que puede intervenir antes y después de una acción. En esta demo se usa
 * la dirección cero: no hay extensión conectada.
 */

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

// IERC165 permite que otro contrato compruebe si una dirección ofrece esta interfaz.
interface IACPHook is IERC165 {
    // Punto de extensión previo: recibe ID del encargo, selector de la función
    // y datos adicionales codificados. Una reversión del hook revierte la operación.
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
    // Punto de extensión posterior dentro de la misma transacción.
    // No es una tarea en segundo plano: también puede revertir toda la operación.
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
