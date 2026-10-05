// ATENÇÃO: Substitua pelo link gerado no seu Teachable Machine
const URL = "https://teachablemachine.withgoogle.com/models/OY2qUkn4l/";

let model, webcam, labelContainer, maxPredictions;
let statusBox = document.getElementById("status-box");
let audioContext;
let inicioEscorado = null;
let ultimoBip = 0;

document.getElementById("btn-start").addEventListener("click", init);

// No modelo, "apoiado" representa a postura incorreta e "não apoiado" a postura correta.
const CLASSE_ERETO = "não apoiado";
const CLASSE_ESCORADO = "apoiado";
const CLASSE_FUNDO = "fundo";
const TEMPO_PARA_ALERTA = 1500;
const INTERVALO_BIP = 1000;

function normalizarLabel(valor) {
    return String(valor)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function pararWebcam() {
    if (webcam?.webcam?.srcObject) webcam.stop();
}

function emitirBip() {
    if (!audioContext) return;
    if (audioContext.state === "suspended") {
        audioContext.resume().catch(error => {
            console.error("Não foi possível reativar o áudio do alerta.", error);
        });
        return;
    }
    if (audioContext.state !== "running") return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(850, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.15);
}

async function init() {
    const startButton = document.getElementById("btn-start");
    startButton.disabled = true;
    startButton.textContent = "Iniciando...";

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx && !audioContext) {
            audioContext = new AudioCtx();
            audioContext.resume().catch(error => {
                console.error("Não foi possível ativar o áudio do alerta.", error);
            });
        }

        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            throw new Error("A câmera só funciona em uma página HTTPS ou em localhost. Abra o site usando um desses endereços.");
        }
        if (!window.tmImage) {
            throw new Error("A biblioteca do Teachable Machine não carregou. Verifique sua conexão e recarregue a página.");
        }

        statusBox.textContent = "Carregando modelo...";
        statusBox.className = "";
        const modelURL = URL + "model.json";
        const metadataURL = URL + "metadata.json";
        model = await tmImage.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();

        statusBox.textContent = "Solicitando acesso à câmera...";
        pararWebcam();
        webcam = new tmImage.Webcam(320, 320, true);
        await webcam.setup();
        await webcam.play();

        const webcamContainer = document.getElementById("webcam-container");
        webcamContainer.replaceChildren(webcam.canvas);
        labelContainer = document.getElementById("label-container");
        labelContainer.replaceChildren();
        for (let i = 0; i < maxPredictions; i++) {
            labelContainer.appendChild(document.createElement("div"));
        }

        startButton.textContent = "Monitor ativo";
        statusBox.textContent = "Câmera ativa. Analisando postura...";
        statusBox.className = "";
        window.requestAnimationFrame(loop);
    } catch (error) {
        pararWebcam();
        const reason = error.name === "NotAllowedError" || error.name === "SecurityError"
            ? "Acesso à câmera negado. Permita o uso da câmera nas configurações do navegador e tente novamente."
            : error.name === "NotFoundError"
                ? "Nenhuma câmera foi encontrada neste dispositivo."
                : error.name === "NotReadableError"
                    ? "A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente."
                    : error.message || "Erro desconhecido.";

        statusBox.textContent = `Não foi possível iniciar: ${reason}`;
        statusBox.className = "status-erro";
        startButton.disabled = false;
        startButton.textContent = "Tentar novamente";
    }
}

async function loop() {
    try {
        webcam.update();
        await predict();
        window.requestAnimationFrame(loop);
    } catch (error) {
        pararWebcam();
        statusBox.textContent = `Erro durante a análise: ${error.message || "falha ao processar a câmera."}`;
        statusBox.className = "status-erro";
        const startButton = document.getElementById("btn-start");
        startButton.disabled = false;
        startButton.textContent = "Tentar novamente";
    }
}

async function predict() {
    const prediction = await model.predict(webcam.canvas);

    let probEreto = 0;
    let probEscorado = 0;
    let probFundo = 0;

    // Renderiza as barras de porcentagem e armazena os valores atuais
    for (let i = 0; i < maxPredictions; i++) {
        const className = prediction[i].className;
        const probability = prediction[i].probability;
        const normalize = normalizarLabel(className);

        labelContainer.childNodes[i].innerHTML = `
            <div class="label-bar">
                <span><strong>${className}:</strong></span>
                <span>${(probability * 100).toFixed(0)}%</span>
            </div>`;

        if (normalize === normalizarLabel(CLASSE_ERETO)) probEreto = probability;
        if (normalize === normalizarLabel(CLASSE_ESCORADO)) probEscorado = probability;
        if (normalize === normalizarLabel(CLASSE_FUNDO)) probFundo = probability;
    }

    // Lógica de tomada de decisão baseada na maior probabilidade
    if (probFundo > 0.60) {
        // Caso a classe "fundo" seja predominante (Ninguém na tela)
        inicioEscorado = null;
        ultimoBip = 0;
        statusBox.innerHTML = "Ausente 👥";
        statusBox.className = "status-fundo";
    } else if (probEscorado > 0.70 && probEscorado >= probEreto) {
        // Aluno se escorou
        const agora = performance.now();
        if (inicioEscorado === null) inicioEscorado = agora;

        if (agora - inicioEscorado >= TEMPO_PARA_ALERTA) {
            statusBox.innerHTML = "Postura Incorreta! 🚨";
            statusBox.className = "status-alerta";

            if (agora - ultimoBip >= INTERVALO_BIP) {
                emitirBip();
                ultimoBip = agora;
            }
        } else {
            statusBox.innerHTML = "Detectando deslize...";
            statusBox.className = "";
        }
    } else {
        // Aluno na postura correta ("não apoiado")
        inicioEscorado = null;
        ultimoBip = 0;
        statusBox.innerHTML = "Postura OK ✔";
        statusBox.className = "status-ok";
    }
}
