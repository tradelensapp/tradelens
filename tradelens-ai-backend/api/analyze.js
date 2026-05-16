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

function extractTicker(message = "") {
  const text = String(message).toUpperCase();

  const knownTickers = [
    "AAPL", "TSLA", "NVDA", "MSFT", "AMD", "META", "GOOGL", "GOOG",
    "AMZN", "NFLX", "PLTR", "COIN", "MSTR", "AVGO", "INTC", "BABA",
    "DIS", "NKE", "JPM", "BAC", "V", "MA", "SPY", "QQQ"
  ];

  for (const ticker of knownTickers) {
    const regex = new RegExp(`\\b${ticker}\\b`, "i");
    if (regex.test(text)) return ticker;
  }

  const companyMap = {
    APPLE: "AAPL",
    TESLA: "TSLA",
    NVIDIA: "NVDA",
    MICROSOFT: "MSFT",
    AMD: "AMD",
    META: "META",
    FACEBOOK: "META",
    GOOGLE: "GOOGL",
    ALPHABET: "GOOGL",
    AMAZON: "AMZN",
    NETFLIX: "NFLX",
    PALANTIR: "PLTR",
    COINBASE: "COIN",
    MICROSTRATEGY: "MSTR",
    BROADCOM: "AVGO",
    INTEL: "INTC",
    ALIBABA: "BABA",
    DISNEY: "DIS",
    NIKE: "NKE",
    "JP MORGAN": "JPM",
    JPMORGAN: "JPM",
    "BANK OF AMERICA": "BAC",
    VISA: "V",
    MASTERCARD: "MA"
  };

  for (const [name, ticker] of Object.entries(companyMap)) {
    if (text.includes(name)) return ticker;
  }

  const possibleTicker = text.match(/\b[A-Z]{1,5}\b/);
  return possibleTicker ? possibleTicker[0] : "";
}

function formatDate(date) {
  return date.toISOString().split("T")[0];
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Error consultando API externa: ${response.status}`);
  }

  return await response.json();
}

async function getMarketData(ticker) {
  if (!process.env.FINNHUB_API_KEY) {
    return {
      ticker,
      available: false,
      error: "Falta FINNHUB_API_KEY en Vercel."
    };
  }

  if (!ticker) {
    return {
      ticker: "",
      available: false,
      error: "No se detectó ticker."
    };
  }

  const token = process.env.FINNHUB_API_KEY;
  const baseUrl = "https://finnhub.io/api/v1";

  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 7);

  const quoteUrl = `${baseUrl}/quote?symbol=${encodeURIComponent(ticker)}&token=${token}`;
  const profileUrl = `${baseUrl}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${token}`;
  const newsUrl = `${baseUrl}/company-news?symbol=${encodeURIComponent(ticker)}&from=${formatDate(sevenDaysAgo)}&to=${formatDate(today)}&token=${token}`;

  const [quote, profile, news] = await Promise.all([
    fetchJson(quoteUrl),
    fetchJson(profileUrl),
    fetchJson(newsUrl)
  ]);

  const currentPrice = quote?.c ?? null;
  const previousClose = quote?.pc ?? null;
  const change = currentPrice && previousClose ? currentPrice - previousClose : null;
  const changePercent = currentPrice && previousClose ? ((change / previousClose) * 100) : null;

  const cleanNews = Array.isArray(news)
    ? news.slice(0, 5).map(item => ({
        headline: item.headline || "",
        source: item.source || "",
        datetime: item.datetime ? new Date(item.datetime * 1000).toISOString() : "",
        summary: item.summary || "",
        url: item.url || ""
      }))
    : [];

  return {
    ticker,
    available: true,
    quote: {
      currentPrice,
      high: quote?.h ?? null,
      low: quote?.l ?? null,
      open: quote?.o ?? null,
      previousClose,
      change,
      changePercent,
      timestamp: quote?.t ? new Date(quote.t * 1000).toISOString() : null
    },
    profile: {
      name: profile?.name || "",
      ticker: profile?.ticker || ticker,
      exchange: profile?.exchange || "",
      industry: profile?.finnhubIndustry || "",
      marketCapitalization: profile?.marketCapitalization || null,
      currency: profile?.currency || "",
      ipo: profile?.ipo || "",
      weburl: profile?.weburl || "",
      logo: profile?.logo || ""
    },
    news: cleanNews
  };
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
6. Distingue entre datos reales, análisis e incertidumbre.
7. Si los datos están incompletos, dilo claramente.
8. Usa lenguaje educativo, profesional y claro.
9. Clasifica el análisis como investigación, no como instrucción de inversión.
10. Finaliza con una advertencia breve.
`;
}

async function runMainAgent(userMessage, marketData) {
  const prompt = `
Eres el Agente Principal de TradeLens AI.

Tu trabajo:
Analizar la solicitud del usuario usando los datos reales disponibles de mercado.
No inventes datos que no estén en el JSON.

${buildBaseRules()}

Solicitud del usuario:
${userMessage}

Datos reales disponibles:
${JSON.stringify(marketData, null, 2)}

Devuelve:
- Resumen ejecutivo
- Datos clave observados
- Contexto general de la empresa
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

async function runRiskAgent(userMessage, marketData, mainAnalysis) {
  const prompt = `
Eres el Risk Agent de TradeLens AI.

Tu trabajo:
Evaluar riesgos financieros, de mercado y de comportamiento del activo mencionado por el usuario.

No debes recomendar comprar o vender.
No inventes datos.
Usa solamente el análisis y los datos disponibles.

Solicitud del usuario:
${userMessage}

Datos reales disponibles:
${JSON.stringify(marketData, null, 2)}

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

async function runTruthGuard(userMessage, marketData, mainAnalysis, riskAnalysis) {
  const prompt = `
Eres Truth Guard, el verificador de exactitud de TradeLens AI.

Tu trabajo:
Revisar si el análisis contiene afirmaciones demasiado fuertes, datos no verificados o frases que aparentan certeza.

Solicitud del usuario:
${userMessage}

Datos reales disponibles:
${JSON.stringify(marketData, null, 2)}

Análisis principal:
${mainAnalysis}

Análisis de riesgo:
${riskAnalysis}

Reglas:
- Si aparece un precio, cambio porcentual, nombre de empresa, exchange o noticia, debe venir del JSON.
- Si algo no está en el JSON, debe marcarse como inferencia o contexto general.
- No permitas promesas de ganancias.
- No permitas recomendaciones directas de compra o venta.

Devuelve:
- Afirmaciones que deben suavizarse
- Datos que requieren fuente
- Posibles exageraciones
- Correcciones necesarias
- Veredicto: Aprobado, Aprobado con cautela o Requiere corrección
`;

  return await callGemini(prompt);
}

async function runComplianceAgent(userMessage, marketData, mainAnalysis, riskAnalysis, verification) {
  const prompt = `
Eres el Compliance Agent de TradeLens AI.

Tu trabajo:
Crear la respuesta final para el usuario usando datos reales disponibles, análisis principal, análisis de riesgo y verificación.

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
- Indicar que faltan datos si aplica

Solicitud del usuario:
${userMessage}

Datos reales disponibles:
${JSON.stringify(marketData, null, 2)}

Análisis principal:
${mainAnalysis}

Análisis de riesgo:
${riskAnalysis}

Verificación Truth Guard:
${verification}

Crea una respuesta final con este formato:

TradeLens AI — Análisis

1. Resumen ejecutivo
2. Datos reales detectados
3. Lectura general
4. Puntos positivos
5. Riesgos principales
6. Noticias recientes relevantes
7. Escenario alcista
8. Escenario neutral
9. Escenario bajista
10. Risk Score
11. Clasificación de investigación
12. Nivel de confianza
13. Próximos datos que conviene verificar
14. Advertencia

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
      message: "TradeLens AI backend con API real de mercado está activo. Usa POST para analizar."
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

    const detectedTicker = cleanText(ticker || extractTicker(userMessage));
    const marketData = await getMarketData(detectedTicker);

    const mainAnalysis = await runMainAgent(userMessage, marketData);
    const riskAnalysis = await runRiskAgent(userMessage, marketData, mainAnalysis);
    const verification = await runTruthGuard(userMessage, marketData, mainAnalysis, riskAnalysis);
    const finalAnswer = await runComplianceAgent(
      userMessage,
      marketData,
      mainAnalysis,
      riskAnalysis,
      verification
    );

    return res.status(200).json({
      success: true,
      mode: "multi-agent-with-market-data",
      ticker: detectedTicker,
      marketData,
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
