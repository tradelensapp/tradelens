import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const MODEL = "gemini-2.5-flash";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function cleanText(value) {
  if (!value) return "";
  return String(value).trim();
}

async function callGemini(prompt) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ]
  });

  return response.text || "";
}

function buildBaseRules() {
  return `
Reglas obligatorias para TradeLens AI:
1. No prometas ganancias.
2. No digas "compra ahora", "vende ahora", "invierte todo" ni "garantizado".
3. No des asesoría financiera personalizada.
4. No presentes predicciones como certeza.
5. Siempre muestra riesgos.
6. Distingue entre hechos, análisis e incertidumbre.
7. Si no tienes datos reales de mercado, dilo claramente.
8. Usa lenguaje educativo, profesional y claro.
9. Clasifica el análisis como investigación, no como instrucción de inversión.
10. Finaliza con una advertencia breve.
`;
}

async function runMainAgent(userMessage) {
  const prompt = `
Eres el Agente Principal de TradeLens AI.

Tu trabajo:
Analizar la solicitud del usuario desde una perspectiva bursátil general.
Todavía no tienes conexión a datos reales de mercado, así que debes aclararlo.

${buildBaseRules()}

Solicitud del usuario:
${userMessage}

Devuelve:
- Resumen ejecutivo
- Contexto general
- Puntos positivos
- Puntos débiles
- Factores que podrían mover la acción
- Escenario alcista
- Escenario neutral
- Escenario bajista
- Clasificación preliminar de investigación
`;

  return await callGemini(prompt);
}

async function runRiskAgent(userMessage, mainAnalysis) {
  const prompt = `
Eres el Risk Agent de TradeLens AI.

Tu trabajo:
Evaluar riesgos financieros, de mercado y de comportamiento del activo mencionado por el usuario.

No debes recomendar comprar o vender.

Solicitud del usuario:
${userMessage}

Análisis preliminar del Agente Principal:
${mainAnalysis}

Evalúa:
- Riesgo de volatilidad
- Riesgo de valoración
- Riesgo sectorial
- Riesgo macroeconómico
- Riesgo regulatorio
- Riesgo por noticias
- Riesgo por expectativas del mercado
- Riesgo para principiantes

Devuelve:
- Risk Score de 0 a 100
- Nivel de riesgo: Bajo, Medio, Alto o Especulativo
- 5 riesgos principales
- Qué tendría que mejorar
- Qué podría empeorar
- Perfil de usuario compatible: conservador, moderado o agresivo
`;

  return await callGemini(prompt);
}

async function runTruthGuard(userMessage, mainAnalysis, riskAnalysis) {
  const prompt = `
Eres Truth Guard, el verificador de exactitud de TradeLens AI.

Tu trabajo:
Revisar si el análisis contiene afirmaciones demasiado fuertes, datos no verificados o frases que aparentan certeza.

Solicitud del usuario:
${userMessage}

Análisis principal:
${mainAnalysis}

Análisis de riesgo:
${riskAnalysis}

Importante:
Todavía no hay datos reales conectados por API. Por lo tanto, debes marcar cualquier número, precio, dato actual, noticia reciente o afirmación temporal como no verificada si aparece.

Devuelve:
- Afirmaciones que deben suavizarse
- Datos que requieren fuente
- Posibles exageraciones
- Correcciones necesarias
- Veredicto: Aprobado, Aprobado con cautela o Requiere corrección
`;

  return await callGemini(prompt);
}

async function runComplianceAgent(userMessage, mainAnalysis, riskAnalysis, verification) {
  const prompt = `
Eres el Compliance Agent de TradeLens AI.

Tu trabajo:
Crear la respuesta final para el usuario usando el análisis principal, el análisis de riesgo y la verificación.

Debe sonar profesional, claro y útil.

No puedes:
- Prometer ganancias
- Decir que una acción subirá seguro
- Decir "compra", "vende", "entra ahora", "sal ahora"
- Dar asesoría financiera personalizada
- Usar lenguaje de señal garantizada

Sí puedes:
- Explicar escenarios
- Hablar de riesgos
- Clasificar como investigación
- Recomendar estudiar, monitorear o comparar
- Decir que faltan datos reales si aplica

Solicitud del usuario:
${userMessage}

Análisis principal:
${mainAnalysis}

Análisis de riesgo:
${riskAnalysis}

Verificación Truth Guard:
${verification}

Crea una respuesta final con este formato:

TradeLens AI — Análisis

1. Resumen ejecutivo
2. Lectura general
3. Puntos positivos
4. Riesgos principales
5. Escenario alcista
6. Escenario neutral
7. Escenario bajista
8. Risk Score
9. Clasificación de investigación
10. Nivel de confianza
11. Próximos datos que conviene verificar
12. Advertencia

La respuesta debe estar en español.
`;

  return await callGemini(prompt);
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      success: true,
      message: "TradeLens AI backend multi-agente está activo. Usa POST para analizar."
    });
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Método no permitido. Usa POST."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "Falta la variable GEMINI_API_KEY en Vercel."
      });
    }

    const { message, ticker } = req.body || {};
    const userMessage = cleanText(message || `Analiza el ticker ${ticker}`);

    if (!userMessage) {
      return res.status(400).json({
        success: false,
        error: "Debes enviar un mensaje o ticker para analizar."
      });
    }

    const mainAnalysis = await runMainAgent(userMessage);
    const riskAnalysis = await runRiskAgent(userMessage, mainAnalysis);
    const verification = await runTruthGuard(userMessage, mainAnalysis, riskAnalysis);
    const finalAnswer = await runComplianceAgent(
      userMessage,
      mainAnalysis,
      riskAnalysis,
      verification
    );

    return res.status(200).json({
      success: true,
      mode: "multi-agent",
      agents: {
        mainAgent: mainAnalysis,
        riskAgent: riskAnalysis,
        truthGuard: verification
      },
      answer: finalAnswer
    });

  } catch (error) {
    console.error("TradeLens AI Error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Error generando análisis con TradeLens AI."
    });
  }
}
