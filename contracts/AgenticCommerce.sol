/**
 * Contrato de comercio con fondos en garantía. Es la implementación de
 * referencia de ERC-8183 con comentarios didácticos en español; no se afirma
 * conformidad completa con el borrador. No ejecuta IA ni entiende los textos:
 * controla roles, estados y transferencias según las llamadas que recibe.
 */

pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "./IACPHook.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

// Initializable: configuración a través del proxy. AccessControl: permisos de
// administración. ReentrancyGuardTransient: bloquea llamadas reentrantes en las
// funciones marcadas. UUPS: actualización de lógica autorizada por el administrador.
contract AgenticCommerce is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardTransient,
    UUPSUpgradeable
{
    // Comprueba el resultado de las transferencias ERC-20 y propaga fallos.
    using SafeERC20 for IERC20;

    // Identificador del rol que puede configurar comisiones y hooks.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // El orden del enum define los números que leen los scripts: 0 a 5.
    // Open: abierto; Funded: financiado; Submitted: entregado; Completed: pagado;
    // Rejected: rechazado; Expired: vencido con devolución reclamada.
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    // Datos persistentes de un encargo; cada actualización queda en la blockchain.
    struct Job {
        // Identificador creciente, distinto de cero para un encargo creado.
        uint256 id;
        // Cuenta que crea el encargo y aporta los tokens.
        address client;
        // Cuenta que fija presupuesto y registra la entrega.
        address provider;
        // Cuenta autorizada a completar o rechazar después de financiar.
        address evaluator;
        // Descripción pública: no debe contener secretos ni el texto privado completo.
        string description;
        // Importe en unidades mínimas del token de pago.
        uint256 budget;
        // Fecha límite como segundos Unix; el reclamo de vencimiento requiere una llamada.
        uint256 expiredAt;
        // Estado que habilita o impide las operaciones siguientes.
        JobStatus status;
        // Extensión opcional; address(0) significa que no se utiliza.
        address hook;
    }

    // Token utilizado como garantía y medio de pago: CAMPUS en el taller.
    IERC20 public paymentToken;
    // Comisión de plataforma en puntos básicos: 100 equivale a 1%; 10000 a 100%.
    uint256 public platformFeeBP;
    // Dirección que recibe la comisión de plataforma, si se configura una.
    address public platformTreasury;
    // Comisión del evaluador en puntos básicos. Ambas comisiones arrancan en cero.
    uint256 public evaluatorFeeBP;

    // Asocia cada ID con el encargo almacenado.
    mapping(uint256 => Job) public jobs;
    // Contador usado para asignar el próximo ID.
    uint256 public jobCounter;
    // Lista de contratos hook autorizados por administración.
    mapping(address => bool) public whitelistedHooks;
    // Marca que se llamó setBudget; esta referencia no exige la marca en fund.
    // El programa del taller fija explícitamente 10 CAMPUS antes de financiar.
    mapping(uint256 jobId => bool hasBudget) public jobHasBudget;

    // Eventos: registros públicos que los scripts pueden leer desde el recibo.
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        address hook
    );
    // Se asignó el proveedor pendiente.
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    // El proveedor fijó o cambió el presupuesto abierto.
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    // Los fondos se depositaron en garantía.
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    // El proveedor publicó la referencia de entrega.
    event JobSubmitted(
        uint256 indexed jobId,
        address indexed provider,
        bytes32 deliverable
    );
    // El evaluador completó el encargo.
    event JobCompleted(
        uint256 indexed jobId,
        address indexed evaluator,
        bytes32 reason
    );
    // Un participante autorizado rechazó el encargo.
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    // Se reclamó una devolución por vencimiento.
    event JobExpired(uint256 indexed jobId);
    // El proveedor recibió el importe neto.
    event PaymentReleased(
        uint256 indexed jobId,
        address indexed provider,
        uint256 amount
    );
    // Se pagó la comisión del evaluador.
    event EvaluatorFeePaid(
        uint256 indexed jobId,
        address indexed evaluator,
        uint256 amount
    );
    // El cliente recuperó el presupuesto.
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);
    // Se cambió la autorización de una extensión.
    event HookWhitelistUpdated(address indexed hook, bool status);

    // Errores personalizados: revierten la transacción sin conservar cambios parciales.
    // Encargo inexistente o interfaz del hook no válida.
    error InvalidJob();
    // La operación no es válida para el estado o plazo actual.
    error WrongStatus();
    // La cuenta que llama no tiene el rol requerido en el encargo.
    error Unauthorized();
    // Una dirección obligatoria no puede ser cero.
    error ZeroAddress();
    // El plazo indicado no supera los cinco minutos mínimos.
    error ExpiryTooShort();
    // Error declarado en la referencia; esta versión no lo utiliza.
    error ZeroBudget();
    // Falta asignar proveedor antes de financiar.
    error ProviderNotSet();
    // Las comisiones sumadas superan 10000 puntos básicos.
    error FeesTooHigh();
    // La extensión elegida no está autorizada.
    error HookNotWhitelisted();

    /// @custom:oz-upgrades-unsafe-allow constructor
    // Bloquea inicializar directamente la implementación. La instancia que
    // se configura y usa es el proxy, cuyo almacenamiento es independiente.
    constructor() {
        _disableInitializers();
    }

    // Configura token y tesorería una sola vez en el proxy; quien lo inicializa
    // recibe los roles administrativos. Habilita address(0) como ausencia de hook.
    function initialize(address paymentToken_, address treasury_) public initializer {
        if (paymentToken_ == address(0) || treasury_ == address(0))
            revert ZeroAddress();

        __AccessControl_init();

        paymentToken = IERC20(paymentToken_);
        platformTreasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        whitelistedHooks[address(0)] = true;
    }

    // UUPS consulta este permiso antes de actualizar la implementación.
    // El cuerpo está vacío porque la condición se impone con onlyRole.
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ──────────────────── Administración ────────────────────

    // Configura la comisión de plataforma y su destino. Rechaza una dirección
    // cero o una suma de comisiones mayor al 100% del presupuesto.
    function setPlatformFee(
        uint256 feeBP_,
        address treasury_
    ) external onlyRole(ADMIN_ROLE) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBP_ + evaluatorFeeBP > 10000) revert FeesTooHigh();
        platformFeeBP = feeBP_;
        platformTreasury = treasury_;
    }

    // Configura la comisión del evaluador sin permitir que la suma supere 100%.
    function setEvaluatorFee(uint256 feeBP_) external onlyRole(ADMIN_ROLE) {
        if (feeBP_ + platformFeeBP > 10000) revert FeesTooHigh();
        evaluatorFeeBP = feeBP_;
    }

    // Autoriza o desautoriza un hook. La dirección cero sigue reservada para no usar uno.
    function setHookWhitelist(address hook, bool status) external onlyRole(ADMIN_ROLE) {
        if (hook == address(0)) revert ZeroAddress();
        whitelistedHooks[hook] = status;
        emit HookWhitelistUpdated(hook, status);
    }

    // ──────────────────── Funciones auxiliares de hooks ────────────────────

    // Llama al hook antes de la acción, solo si se eligió una extensión.
    function _beforeHook(
        address hook,
        uint256 jobId,
        bytes4 selector,
        bytes memory data
    ) internal {
        if (hook != address(0)) {
            IACPHook(hook).beforeAction(jobId, selector, data);
        }
    }

    // Llama al hook después de la acción, dentro de la misma transacción.
    function _afterHook(
        address hook,
        uint256 jobId,
        bytes4 selector,
        bytes memory data
    ) internal {
        if (hook != address(0)) {
            IACPHook(hook).afterAction(jobId, selector, data);
        }
    }

    // ──────────────────── Ciclo de vida del encargo ────────────────────

    // El remitente será el cliente. Recibe proveedor, evaluador, vencimiento,
    // descripción y hook. El plazo debe superar cinco minutos y el evaluador
    // no puede ser cero. Crear no deposita tokens: el encargo comienza abierto.
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external nonReentrant returns (uint256) {
        if (evaluator == address(0)) revert ZeroAddress();
        if (expiredAt <= block.timestamp + 5 minutes) revert ExpiryTooShort();
        if (!whitelistedHooks[hook]) revert HookNotWhitelisted();
        if (hook != address(0)) {
            if (!ERC165Checker.supportsInterface(hook, type(IACPHook).interfaceId))
                revert InvalidJob();
        }

        // Incrementa el contador y crea el registro. El proveedor puede ser cero
        // inicialmente, para que el cliente lo asigne después con setProvider.
        uint256 jobId = ++jobCounter;
        jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: 0,
            expiredAt: expiredAt,
            status: JobStatus.Open,
            hook: hook
        });

        // Publica el ID y participantes para que el cliente del programa siga el encargo.
        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, hook);
        _afterHook(hook, jobId, msg.sig, abi.encode(msg.sender, provider, evaluator));

        return jobId;
    }

    // Solo el cliente puede asignar un proveedor pendiente mientras el encargo
    // está abierto. Una vez asignado no puede sustituirlo con esta función.
    function setProvider(uint256 jobId, address provider_) external {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider != address(0)) revert WrongStatus();
        if (provider_ == address(0)) revert ZeroAddress();
        job.provider = provider_;
        emit ProviderSet(jobId, provider_);
    }

    // Solo el proveedor puede fijar el presupuesto mientras está abierto.
    // optParams lleva datos opcionales para hooks; en el taller se envía 0x, vacío.
    function setBudget(
        uint256 jobId,
        uint256 amount,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.provider) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, amount, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        job.budget = amount;
        emit BudgetSet(jobId, amount);
        jobHasBudget[jobId] = true;

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    // Solo el cliente financia un encargo abierto, con proveedor y antes de vencer.
    // Requiere autorización ERC-20 previa si el presupuesto es mayor a cero.
    function fund(uint256 jobId, bytes calldata optParams) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider == address(0)) revert ProviderNotSet();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();

        bytes memory data = abi.encode(msg.sender, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        // Actualiza el estado antes de transferir. Si la transferencia revierte,
        // Ethereum revierte también este cambio: no queda financiado sin los tokens.
        job.status = JobStatus.Funded;
        if (job.budget > 0) {
            paymentToken.safeTransferFrom(job.client, address(this), job.budget);
        }
        emit JobFunded(jobId, job.client, job.budget);

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    // Solo el proveedor registra una entrega como bytes32: en el taller es
    // el hash del resumen. Esta referencia admite además encargos abiertos de
    // presupuesto cero; el taller usa siempre la ruta con fondos.
    function submit(
        uint256 jobId,
        bytes32 deliverable,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (
            job.status != JobStatus.Funded &&
            (job.status != JobStatus.Open || job.budget > 0)
        ) revert WrongStatus();
        if (msg.sender != job.provider) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, deliverable, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        job.status = JobStatus.Submitted;
        // La huella se publica en un evento. La estructura Job no almacena ese hash;
        // el programa conserva el texto y su relación con la entrega en el registro local.
        emit JobSubmitted(jobId, job.provider, deliverable);

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    // Solo el evaluador completa una entrega y libera el pago. reason es una
    // referencia de 32 bytes; no ejecuta la evaluación de IA dentro del contrato.
    function complete(
        uint256 jobId,
        bytes32 reason,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Submitted) revert WrongStatus();
        if (msg.sender != job.evaluator) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, reason, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        job.status = JobStatus.Completed;

        // Calcula comisiones con división entera y paga el resto al proveedor.
        // Con comisiones en cero, los 10 CAMPUS completos llegan al proveedor.
        uint256 amount = job.budget;
        uint256 platformFee = (amount * platformFeeBP) / 10000;
        uint256 evalFee = (amount * evaluatorFeeBP) / 10000;
        uint256 net = amount - platformFee - evalFee;

        // Transfiere comisiones solo si corresponden; cualquier fallo revierte la operación.
        if (platformFee > 0) {
            paymentToken.safeTransfer(platformTreasury, platformFee);
        }
        if (evalFee > 0) {
            paymentToken.safeTransfer(job.evaluator, evalFee);
            emit EvaluatorFeePaid(jobId, job.evaluator, evalFee);
        }
        if (net > 0) {
            paymentToken.safeTransfer(job.provider, net);
        }

        emit JobCompleted(jobId, job.evaluator, reason);
        emit PaymentReleased(jobId, job.provider, net);

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    // Mientras está abierto puede rechazar el cliente. Si ya fue financiado
    // o entregado, solo puede hacerlo el evaluador. No permite rechazar estados finales.
    function reject(
        uint256 jobId,
        bytes32 reason,
        bytes calldata optParams
    ) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();

        if (job.status == JobStatus.Open) {
            if (msg.sender != job.client) revert Unauthorized();
        } else if (
            job.status == JobStatus.Funded || job.status == JobStatus.Submitted
        ) {
            if (msg.sender != job.evaluator) revert Unauthorized();
        } else {
            revert WrongStatus();
        }

        bytes memory data = abi.encode(msg.sender, reason, optParams);
        _beforeHook(job.hook, jobId, msg.sig, data);

        // Conserva el estado previo para distinguir un encargo sin depósito de uno con fondos.
        JobStatus prev = job.status;
        job.status = JobStatus.Rejected;

        // Devuelve el presupuesto al cliente únicamente si estaba en garantía.
        if (
            (prev == JobStatus.Funded || prev == JobStatus.Submitted) && job.budget > 0
        ) {
            paymentToken.safeTransfer(job.client, job.budget);
            emit Refunded(jobId, job.client, job.budget);
        }

        emit JobRejected(jobId, msg.sender, reason);

        _afterHook(job.hook, jobId, msg.sig, data);
    }

    // Cualquier cuenta puede activar el reclamo si venció un encargo financiado
    // o entregado. Los fondos siempre vuelven al cliente, no a quien hace la llamada.
    // El tiempo por sí solo no ejecuta esta función: alguien debe enviar la transacción.
    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted)
            revert WrongStatus();
        if (block.timestamp < job.expiredAt) revert WrongStatus();

        // Marca el estado final antes de transferir para impedir un segundo reclamo.
        job.status = JobStatus.Expired;

        if (job.budget > 0) {
            paymentToken.safeTransfer(job.client, job.budget);
            emit Refunded(jobId, job.client, job.budget);
        }

        emit JobExpired(jobId);
    }

    // ──────────────────── Consultas ────────────────────

    // Consulta sin modificar estado: devuelve una copia del encargo.
    // Para un ID inexistente, el mapping devuelve campos en cero.
    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }
}
