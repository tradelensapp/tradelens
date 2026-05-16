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
    throw new Error(`Error consultando Finnhub: ${response.status}`);
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

  const change =
    typeof currentPrice === "number" && typeof previousClose === "number"
      ? currentPrice - previousClose
      : null;

  const changePercent =
    typeof change === "number" && previousClose
      ? (change / previousClose) * 100
      : null;

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

async function callGeminiOptimized(userMessage, marketData) {
  const prompt = `
Eres TradeLens AI, un agente de investigación bursátil con estructura interna multi-agente.

Aunque responderás en una sola salida, debes simular internamente estos roles:
1. Agente Principal: interpreta la solicitud.
2. Market Data Agent: usa solamente el JSON de datos reales disponible.
3. Risk Agent: evalúa riesgos.
4. Truth Guard: verifica que no se inventen datos.
5. Compliance Agent: limpia lenguaje riesgoso o promesas.

Reglas obligatorias:
- No prometas ganancias.
- No digas "compra ahora", "vende ahora", "entra ahora", "sal ahora" o "garantizado".
- No des asesoría financiera personalizada.
- No presentes predicciones como certeza.
- No inventes precios, noticias, porcentajes ni métricas.
- Si falta información, dilo claramente.
- Separa datos reales de análisis e incertidumbre.
- Usa lenguaje profesional, claro y útil.
- Responde en español.
- Finaliza con advertencia breve.

Solicitud del usuario:
${userMessage}

Datos reales disponibles desde Finnhub:
${JSON.stringify(marketData, null, 2)}

Formato obligatorio de respuesta:

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

Notas:
- Si los datos de Finnhub vienen incompletos, acláralo.
- Si no hay noticias recientes suficientes, dilo.
- El Risk Score debe ser una estimación educativa, no una recomendación.
`;

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

function getFriendlyError(error) {
  const message = error?.message || "";

  if (error?.status === 429 || message.includes("429") || message.includes("quota")) {
    return "Gemini alcanzó el límite de uso del plan actual. Espera unos minutos o reduce la cantidad de análisis. En esta versión optimizada, cada análisis usa solo 1 llamada.";
  }

  if (message.includes("FINNHUB_API_KEY")) {
    return "Falta FINNHUB_API_KEY en Vercel.";
  }

  if (message.includes("GEMINI_API_KEY")) {
    return "Falta GEMINI_API_KEY en Vercel.";
  }

  return message || "Error generando análisis con TradeLens AI.";
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      success: true,
      message: "TradeLens AI backend optimizado con Finnhub y Gemini está activo. Usa POST para analizar.",
      mode: "optimized-single-call"
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
        error: "Falta GEMINI_API_KEY en Vercel."
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

    const finalAnswer = await callGeminiOptimized(userMessage, marketData);

    return res.status(200).json({
      success: true,
      mode: "optimized-single-call-with-market-data",
      ticker: detectedTicker,
      marketData,
      answer: finalAnswer
    });

  } catch (error) {
    console.error("TradeLens AI Error:", error);

    return res.status(500).json({
      success: false,
      error: getFriendlyError(error)
    });
  }
}
