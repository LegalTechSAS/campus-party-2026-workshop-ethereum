# Workshop Campus Party
Respondé en español. Leé README.md.
El flujo principal ahora es autónomo: npm run agent ejecuta generación, evaluación y resolución sin aprobación humana por paso. El usuario autoriza el objetivo y la política antes de iniciarlo.
La política está en src/domain/policy.mjs: 10 CAMPUS por pedido, 100 CAMPUS acumulados, 2 intentos, hasta 100 palabras, Sepolia 11155111 (ruta principal); local 31337 solo para pruebas. No cambies esos límites para forzar una aprobación.
VS Code/Claude Code o Cursor ayudan a editar; el proceso del agente consulta Ollama, Claude CLI o Cursor CLI. No inventes resultados ni hashes. No solicites claves privadas ni frases semilla.
El contrato comprueba roles y fondos. La evaluación semántica es de IA y puede equivocarse. Dos llamadas separadas no son dos organizaciones independientes.
El modo continuo espera inbox/*.txt mientras el proceso, internet y el proveedor de IA sigan activos. No afirmar que queda desplegado 24/7.

Respetá la dirección de dependencias documentada en ARCHITECTURE.md. Dominio y aplicación no deben importar Node, archivos, ethers o CLIs. Inyectá nuevos servicios mediante puertos. Mantené los comentarios explicativos en español. Antes de entregar cambios, ejecutá npm run verify; npm run format corrige el formato.

No leas ni muestres .env para responder preguntas. Usá sepolia:doctor para diagnosticar solo direcciones y saldos. Nunca incluyas secretos ni datos de ejecución privados en el ZIP. Los hashes de pruebas simuladas no deben presentarse como transacciones públicas.
